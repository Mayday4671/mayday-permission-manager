/**
 * 文件中心真实 HTTP/MySQL 验收，仅允许 verify-baseline 的随机隔离项目。
 * 不修改部署存储配置，不操作日常目录；所有账户、目录、文件和业务引用均登记精确 ID 后清理。
 */
import {
  isolatedSql,
  isolatedComposeArguments,
} from "./support/isolated-compose.mjs";
import test from "node:test";
import {
  bindTestPortalCategory,
  deleteTestPortalChannel,
} from "./support/portal.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { loginWithCaptcha } from "./support/captcha.mjs";
import { purgeTestFiles } from "./support/files-cleanup.mjs";
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { fileManifest, assertRestoredFiles } from "../scripts/file-backup.mjs";

const base = process.env.API_BASE;
const project = process.env.API_TEST_COMPOSE_PROJECT;
const database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["fresh-db", "upgrade-db"].includes(database) &&
  Boolean(base && process.env.ADMIN_PASSWORD);
const prefix = "qa_files_" + Date.now().toString(36);
const password = "FileCenter_Qa2026!";

/** 经真实认证链调用业务接口，错误输出仅含状态和业务消息，不输出令牌或下载正文。 */
async function call(path, token, method = "GET", data, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${body.message}`);
  if (status < 400) assert.equal(body.success, true);
  return body.data;
}

/** SQL 只用于核对存储状态和构造旧格式兼容样本，目标必须为已确认的本次隔离库。 */
function sql(statement) {
  assert(isolated, "SQL 仅允许本次独立验收项目");
  return isolatedSql(statement).trim();
}

/** 生成有效栅格 PNG，避免伪装图片或损坏的网络样本让缩略图验收失去意义。 */
function png(width = 640, height = 320) {
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, content) => {
    const body = Buffer.concat([Buffer.from(type), content]);
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(content.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels[offset] = 24;
      pixels[offset + 1] = 160;
      pixels[offset + 2] = 150;
      pixels[offset + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test(
  "文件中心存储、目录、权限、批量事务和回收站",
  { skip: !isolated },
  async (t) => {
    const admin = (
      await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
    ).token;
    const made = {
      users: [],
      roles: [],
      files: [],
      directories: [],
      notices: [],
      categories: [],
      portalChannels: [],
    };
    const permissions = [
      "files:view",
      "files:create",
      "files:update",
      "files:delete",
      "files:restore",
      "files:purge",
      "files:download",
      "notices:view",
      "notices:create",
      "notices:delete",
      "notices:purge",
    ];
    const batch = (token, action, ids, directoryId, status = 200) =>
      call(
        "/operations/files/batch",
        token,
        "POST",
        { action, ids, directoryId },
        status,
      );
    const metadata = (id, token = admin) =>
      call(`/operations/files/${id}`, token);
    async function account(label, grants = permissions) {
      const role = await call("/system/roles", admin, "POST", {
        name: prefix + label,
        code: prefix + label,
        enabled: true,
        permissions: grants,
        dataScopes: { users: "SELF", notices: "SELF" },
      });
      made.roles.push(role.id);
      const user = await call("/system/users", admin, "POST", {
        username: prefix + label,
        nickname: label,
        enabled: true,
        password,
        roleIds: [role.id],
      });
      made.users.push(user.id);
      return {
        user,
        token: (await loginWithCaptcha(base, user.username, password)).token,
      };
    }
    async function directory(token, name, parentId = 0) {
      const value = await call("/operations/files/directories", token, "POST", {
        name,
        parentId,
      });
      made.directories.push(value.id);
      return value;
    }
    async function upload(token, name, bytes, directoryId, status = 200) {
      const body = new FormData();
      body.append("file", new Blob([bytes]), name);
      const response = await fetch(
        base +
          "/operations/files" +
          (directoryId ? `?directoryId=${directoryId}` : ""),
        {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body,
          signal: AbortSignal.timeout(30000),
        },
      );
      const result = await response.json();
      assert.equal(response.status, status, "受管文件上传: " + result.message);
      if (status < 400) made.files.push(result.data.id);
      return result.data;
    }
    async function binary(id, token, action = "download", status = 200) {
      const response = await fetch(`${base}/operations/files/${id}/${action}`, {
        headers: token ? { Authorization: "Bearer " + token } : {},
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(
        response.status,
        status,
        `文件 ${action} 状态不符合授权边界`,
      );
      return { response, bytes: Buffer.from(await response.arrayBuffer()) };
    }
    let first, second, restricted, parent, child, foreign, image, text, other;
    try {
      first = await account("first");
      second = await account("second");
      restricted = await account("view_only", ["files:view"]);
      await t.test(
        "部署限额只返回公开上传信息，不泄露存储配置和密钥",
        async () => {
          const config = await call(
            "/operations/files/storage-info",
            first.token,
          );
          assert.equal(
            config.provider,
            "LOCAL",
            "文件中心真实 HTTP 验收应在隔离 LOCAL 存储运行",
          );
          assert(
            config.maximumBytes >= 1024 * 1024 &&
              config.maximumBytes <= 100 * 1024 * 1024,
          );
          assert.deepEqual(Object.keys(config).sort(), [
            "extensions",
            "maximumBytes",
            "provider",
          ]);
          assert(config.extensions.includes("png"));
          await call(
            "/operations/files/storage-info",
            undefined,
            "GET",
            undefined,
            401,
          );
        },
      );
      await t.test(
        "目录隔离、同级唯一、版本冲突、环和控制字符校验",
        async () => {
          parent = await directory(first.token, prefix + "_root");
          child = await directory(first.token, prefix + "_child", parent.id);
          foreign = await directory(second.token, prefix + "_root");
          const own = await call("/operations/files/directories", first.token);
          assert(own.every((item) => item.ownerId === first.user.id));
          await call(
            "/operations/files/directories",
            first.token,
            "POST",
            { name: parent.name, parentId: 0 },
            400,
          );
          await call(
            "/operations/files/directories",
            first.token,
            "POST",
            { name: "a\nb\nc", parentId: 0 },
            400,
          );
          await call(
            "/operations/files/directories",
            first.token,
            "POST",
            { name: "../escape", parentId: 0 },
            400,
          );
          await call(
            `/operations/files/directories/${parent.id}`,
            first.token,
            "PUT",
            { name: parent.name, parentId: child.id, version: parent.version },
            400,
          );
          await call(
            `/operations/files/directories/${child.id}`,
            first.token,
            "PUT",
            { name: child.name, parentId: foreign.id, version: child.version },
            403,
          );
          const before = parent;
          parent = await call(
            `/operations/files/directories/${parent.id}`,
            first.token,
            "PUT",
            { name: prefix + "_renamed", parentId: 0, version: parent.version },
          );
          await call(
            `/operations/files/directories/${parent.id}`,
            first.token,
            "PUT",
            { name: before.name, parentId: 0, version: before.version },
            409,
          );
        },
      );
      await t.test("本地正文和缩略图真实保存，元信息不返回对象键", async () => {
        const original = png();
        image = await upload(first.token, prefix + ".png", original, child.id);
        text = await upload(first.token, prefix + ".txt", "测试正文");
        other = await upload(
          second.token,
          prefix + "_other.txt",
          "其他所有者",
          foreign.id,
        );
        assert.equal(image.storageProvider, "LOCAL");
        for (const key of [
          "storageKey",
          "thumbnailKey",
          "data",
          "bucket",
          "accessKey",
          "secretKey",
        ])
          assert(!Object.hasOwn(image, key), "元信息泄露存储字段: " + key);
        assert.equal(
          sql(
            `SELECT storage_provider, storage_key IS NOT NULL, thumbnail_key IS NOT NULL FROM ops_file WHERE id=${image.id};`,
          ),
          "LOCAL\t1\t1",
        );
        assert.equal(
          sql(`SELECT COUNT(*) FROM ops_file_payload WHERE id=${image.id};`),
          "0",
        );
        const downloaded = await binary(image.id, first.token);
        assert.deepEqual(downloaded.bytes, original);
        assert.match(
          downloaded.response.headers.get("Content-Disposition"),
          /^attachment;/,
        );
        const preview = await binary(image.id, first.token, "preview");
        assert.match(
          preview.response.headers.get("Content-Type"),
          /^image\/png/,
        );
        assert.equal(
          preview.response.headers.get("X-Content-Type-Options"),
          "nosniff",
        );
        assert.match(
          preview.response.headers.get("Content-Security-Policy"),
          /sandbox/,
        );
        const thumbnail = await binary(image.id, first.token, "thumbnail");
        assert.equal(thumbnail.bytes.readUInt32BE(16), 320);
        assert.equal(thumbnail.bytes.readUInt32BE(20), 160);
        await binary(text.id, first.token, "preview", 400);
        await upload(
          first.token,
          prefix + "_fake.png",
          "<html><script>bad()</script></html>",
          undefined,
          400,
        );
        await upload(
          first.token,
          prefix + ".exe",
          "不支持的类型",
          undefined,
          400,
        );
        await call(
          `/operations/files/directories/${child.id}?version=${child.version}`,
          first.token,
          "DELETE",
          undefined,
          400,
        );
      });
      await t.test(
        "LOCAL 备份恢复后正文、缩略图和原数据库文件引用仍可读取",
        async () => {
          assert(isolated, "恢复检查只允许隔离环境");
          const service =
            database === "upgrade-db" ? "backend-upgrade" : "backend-fresh";
          const compose = isolatedComposeArguments();
          const docker = (args) => {
            const result = spawnSync("docker", args, {
              encoding: "utf8",
              windowsHide: true,
              timeout: 180000,
            });
            assert.equal(result.status, 0, "隔离文件恢复命令未完成");
            assert(!result.error, "隔离文件恢复命令异常");
            return result.stdout.trim();
          };
          // SQL取出的键仍必须属于刚上传的测试账号和严格UUID路径，不能用请求参数拼接任意文件路径。
          const key = sql(
            `SELECT storage_key FROM ops_file WHERE id=${image.id} AND owner_id=${first.user.id};`,
          );
          assert(/^[a-f0-9]{2}\/[a-f0-9-]{36}$/.test(key));
          const output = resolve(
            ".local",
            "file-recovery",
            project,
            database,
            prefix,
          );
          const saved = join(output, "files");
          const restored = join(output, "restored");
          mkdirSync(saved, { recursive: true });
          mkdirSync(restored);
          let stopped = false;
          let backup;
          // 本机验收同样执行正文丢失与恢复。只接受明确标识的本次隔离目录，禁止指向日常存储。
          const nativeRoot = process.env.API_TEST_NATIVE_FILES;
          const container = nativeRoot
            ? null
            : docker([...compose, "ps", "-q", service]);
          if (!nativeRoot) assert(/^[a-f0-9]{12,64}$/.test(container));
          if (nativeRoot) {
            // 正式本机验收目录由已校验的随机项目名派生，不接受环境变量指定任意允许根目录。
            const isolatedRoot = resolve(
              ".local",
              "baseline",
              project.replace(/^mayday-check-/, ""),
              "native-files",
              database === "fresh-db" ? "fresh" : "upgrade",
            );
            const legacyRoot = resolve(
              ".local",
              database === "fresh-db"
                ? "full-functions-fresh-files"
                : "full-functions-files",
            );
            const requested = realpathSync(nativeRoot);
            const allowed = realpathSync(
              requested === isolatedRoot ? isolatedRoot : legacyRoot,
            );
            assert.equal(
              realpathSync(nativeRoot),
              allowed,
              "本机恢复只能操作本次独立验收目录",
            );
            const target = resolve(allowed, key);
            const inside = relative(allowed, realpathSync(target));
            assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
            // 此子测试无并发写入；删除前先校验全目录无符号链接，并保存每个对象的摘要。
            backup = fileManifest(allowed);
            cpSync(allowed, saved, { recursive: true });
            assertRestoredFiles(backup, fileManifest(saved));
            try {
              unlinkSync(target);
              await binary(image.id, first.token, "download", 400);
            } finally {
              // 无论接口断言是否成功，都恢复刚登记的测试对象，不覆盖其他对象或数据库元信息。
              copyFileSync(resolve(saved, key), target);
            }
            cpSync(allowed, restored, { recursive: true });
            assertRestoredFiles(backup, fileManifest(restored));
            writeFileSync(
              join(output, "manifest.json"),
              JSON.stringify(backup, null, 2) + "\n",
            );
          } else {
            try {
              docker([...compose, "stop", service]);
              stopped = true;
              docker(["cp", `${container}:/app/data/files/.`, saved]);
              backup = fileManifest(saved);
              writeFileSync(
                join(output, "manifest.json"),
                JSON.stringify(backup, null, 2) + "\n",
              );
              docker([
                ...compose,
                "up",
                "-d",
                "--no-build",
                "--wait",
                "--wait-timeout",
                "180",
                service,
              ]);
              stopped = false;
              // 只移除已登记测试图片的对象；元信息保留，模拟正文丢失。绝不清空整卷。
              docker([
                "exec",
                "--user",
                "0",
                container,
                "rm",
                "--",
                `/app/data/files/${key}`,
              ]);
              await binary(image.id, first.token, "download", 400);
              docker([...compose, "stop", service]);
              stopped = true;
              docker(["cp", saved + "/.", `${container}:/app/data/files`]);
              docker(["cp", `${container}:/app/data/files/.`, restored]);
              assertRestoredFiles(backup, fileManifest(restored));
            } finally {
              if (stopped) {
                // cp在宿主机备份后不保证Linux属主；启动后用固定存储目录恢复应用用户写权限。
                docker([
                  ...compose,
                  "up",
                  "-d",
                  "--no-build",
                  "--wait",
                  "--wait-timeout",
                  "180",
                  service,
                ]);
                docker([
                  "exec",
                  "--user",
                  "0",
                  container,
                  "chown",
                  "-R",
                  "mayday:mayday",
                  "/app/data/files",
                ]);
              }
            }
          }
          assert.deepEqual((await binary(image.id, first.token)).bytes, png());
          const thumbnail = await binary(image.id, first.token, "thumbnail");
          assert.equal(thumbnail.bytes.readUInt32BE(16), 320);
          assert.equal(thumbnail.bytes.readUInt32BE(20), 160);
          assert.equal(
            (await metadata(image.id, first.token)).directoryId,
            child.id,
          );
          writeFileSync(
            join(output, "result.json"),
            JSON.stringify(
              {
                status: "passed",
                files: backup.files.length,
                bytes: backup.bytes,
                imageId: image.id,
                databaseReferenceRetained: true,
              },
              null,
              2,
            ) + "\n",
          );
        },
      );
      await t.test(
        "跨用户猜测文件和目录被拒绝，查看权限不等于下载或编辑权限",
        async () => {
          await metadata(image.id, first.token);
          await call(
            `/operations/files/${image.id}`,
            second.token,
            "GET",
            undefined,
            403,
          );
          await binary(image.id, second.token, "download", 403);
          await binary(image.id, second.token, "thumbnail", 403);
          await binary(image.id, undefined, "download", 401);
          await binary(image.id, restricted.token, "download", 403);
          await batch(restricted.token, "MOVE", [image.id], 0, 403);
          await upload(
            second.token,
            prefix + "_foreign.txt",
            "越权目录",
            child.id,
            403,
          );
          const list = await call(
            `/operations/files?keyword=${prefix}&size=100`,
            first.token,
          );
          assert(list.items.every((file) => file.ownerId === first.user.id));
          await call(
            `/operations/files?directoryId=${foreign.id}`,
            first.token,
            "GET",
            undefined,
            403,
          );
        },
      );
      await t.test(
        "跨所有者批量移动整批回滚，合法移动与目录筛选一致",
        async () => {
          const before = await metadata(text.id);
          await batch(first.token, "MOVE", [text.id, other.id], child.id, 403);
          assert.deepEqual(await metadata(text.id), before);
          const otherBefore = await metadata(other.id);
          await batch(admin, "MOVE", [text.id, other.id], child.id, 400);
          assert.deepEqual(await metadata(text.id), before);
          assert.deepEqual(await metadata(other.id), otherBefore);
          assert.equal(
            (await batch(first.token, "MOVE", [text.id], child.id)).count,
            1,
          );
          const inDirectory = await call(
            `/operations/files?directoryId=${child.id}&keyword=${prefix}&size=100`,
            first.token,
          );
          assert.deepEqual(
            inDirectory.items.map((file) => file.id).sort((a, b) => a - b),
            [image.id, text.id].sort((a, b) => a - b),
          );
          await batch(first.token, "MOVE", [text.id], 0);
        },
      );
      await t.test(
        "回收与恢复保留正文，回收记录不能预览，清理完成后元信息和正文同步消失",
        async () => {
          await batch(first.token, "RECYCLE", [text.id]);
          await binary(text.id, first.token, "download", 400);
          const ordinary = await call(
            `/operations/files?keyword=${prefix}&size=100`,
            first.token,
          );
          assert(!ordinary.items.some((file) => file.id === text.id));
          const recycle = await call(
            `/operations/files?deleted=true&keyword=${prefix}&size=100`,
            first.token,
          );
          assert(recycle.items.some((file) => file.id === text.id));
          await batch(first.token, "RESTORE", [text.id]);
          assert.equal(
            (await binary(text.id, first.token)).bytes.toString(),
            "测试正文",
          );
          const disposable = await upload(
            first.token,
            prefix + "_purge.txt",
            "永久删除样本",
          );
          await purgeTestFiles(base, admin, [disposable.id]);
          await call(
            `/operations/files/${disposable.id}`,
            admin,
            "GET",
            undefined,
            400,
          );
          assert.equal(
            sql(`SELECT COUNT(*) FROM ops_file WHERE id=${disposable.id};`),
            "0",
          );
        },
      );
      await t.test(
        "业务关联文件不得回收，内容修订移除当前附件后历史引用仍有效",
        async () => {
          const category = await call(
            "/system/entries/categories",
            admin,
            "POST",
            {
              name: prefix + "_category",
              code: prefix + "_category",
              enabled: true,
              sortOrder: 0,
            },
          );
          made.categories.push(category.id);
          made.portalChannels.push(
            await bindTestPortalCategory(base, admin, category),
          );
          const draft = {
            title: prefix + "_draft",
            categoryId: category.id,
            content: "<p>附件引用测试</p>",
            contentFormat: "HTML",
            visibility: "INTERNAL",
            attachmentIds: [image.id],
            tagIds: [],
            requiresApproval: false,
          };
          const notice = await call(
            "/content/notices",
            first.token,
            "POST",
            draft,
          );
          made.notices.push(notice.id);
          await batch(
            first.token,
            "RECYCLE",
            [image.id, text.id],
            undefined,
            400,
          );
          assert.equal(
            (await metadata(text.id)).deletedAt,
            null,
            "引用失败不能先回收批次中的其他文件",
          );
          await call(`/content/notices/${notice.id}`, admin, "PUT", {
            ...draft,
            attachmentIds: [],
            version: notice.version,
          });
          await call(
            `/operations/files/${image.id}`,
            first.token,
            "DELETE",
            undefined,
            400,
          );
          await call("/content/notices", second.token, "POST", draft, 403);
        },
      );
      await t.test(
        "旧 MYSQL 正文仍可鉴权下载，永久清理同时移除旧负载",
        async () => {
          const bytes = Buffer.from("legacy-MYSQL-body");
          const id = Number(
            sql(
              `INSERT INTO ops_file(created_at,updated_at,version,name,content_type,size,owner_id,owner_name,storage_provider) VALUES(NOW(),NOW(),0,'${prefix}_legacy.txt','text/plain',${bytes.length},${first.user.id},'first','MYSQL'); SELECT LAST_INSERT_ID();`,
            ),
          );
          assert(Number.isSafeInteger(id) && id > 0);
          made.files.push(id);
          sql(
            `INSERT INTO ops_file_payload(id,data) VALUES(${id},UNHEX('${bytes.toString("hex")}'));`,
          );
          assert.equal((await metadata(id)).storageProvider, "MYSQL");
          assert.deepEqual((await binary(id, first.token)).bytes, bytes);
          await binary(id, second.token, "download", 403);
          await purgeTestFiles(base, admin, [id]);
          assert.equal(
            sql(`SELECT COUNT(*) FROM ops_file_payload WHERE id=${id};`),
            "0",
          );
        },
      );
    } finally {
      // 先移除业务历史引用，再清理文件，最后删除空目录和所有者；任何清理失败仍继续其他清理。
      const errors = [];
      const cleanup = async (action) => {
        try {
          await action();
        } catch (error) {
          errors.push(error);
        }
      };
      for (const id of made.notices.reverse())
        await cleanup(async () => {
          await call(`/content/notices/${id}`, admin, "DELETE");
          await call(`/content/notices/${id}/purge`, admin, "DELETE");
        });
      await cleanup(() => purgeTestFiles(base, admin, made.files));
      for (const id of made.directories.reverse())
        await cleanup(async () => {
          const latest = (
            await call("/operations/files/directories", admin)
          ).find((item) => item.id === id);
          if (latest)
            await call(
              `/operations/files/directories/${id}?version=${latest.version}`,
              admin,
              "DELETE",
            );
        });
      for (const id of made.categories.reverse())
        await cleanup(() =>
          call(`/system/entries/categories/${id}`, admin, "DELETE"),
        );
      for (const id of made.users.reverse())
        await cleanup(() => call(`/system/users/${id}`, admin, "DELETE"));
      for (const channel of made.portalChannels.reverse())
        await cleanup(() => deleteTestPortalChannel(base, admin, channel));
      for (const id of made.roles.reverse())
        await cleanup(() => call(`/system/roles/${id}`, admin, "DELETE"));
      await cleanup(() => call("/auth/logout", admin, "POST"));
      if (errors.length)
        throw new AggregateError(errors, "文件中心隔离验收清理失败");
    }
  },
);
