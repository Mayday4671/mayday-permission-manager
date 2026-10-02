/**
 * 批量导入/导出的真实 HTTP 与 MySQL 验收，只在随机隔离 Docker 项目中执行。
 * 对账号、角色和作业登记精确 ID，结束时等待服务端真实过期清理，不清空日常库或文件目录。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loginWithCaptcha } from "./support/captcha.mjs";

const base = process.env.API_BASE;
const project = process.env.API_TEST_COMPOSE_PROJECT;
const database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database) &&
  Boolean(base && process.env.ADMIN_PASSWORD);
const prefix = "qa_bulk_" + Date.now().toString(36);
const password = "Bulk_Qa2026!";

/** JSON 验收不输出请求或成功正文，避免登录凭证和初始密码进入测试日志。 */
async function call(path, token, method = "GET", data, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `${method} ${path}: 响应状态不符`);
  const body = await response.json();
  assert.equal(body.success, expected < 400);
  return body.data;
}

/** 原文件以 multipart 上传，提交幂等键固定在同一文件重试之间，不信任浏览器预览结果。 */
async function upload(action, token, content, key, expected = 200) {
  const body = new FormData();
  body.append("file", new Blob([content], { type: "text/csv" }), "users.csv");
  if (key) body.append("idempotencyKey", key);
  const response = await fetch(base + "/bulk/users/import/" + action, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body,
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.status, expected, `导入 ${action} 响应状态不符`);
  const result = await response.json();
  assert.equal(result.success, expected < 400);
  return result.data;
}

/** 读取模板/结果需头部鉴权；错误 JSON 不能被误当作下载成功。 */
async function download(path, token, expected = 200) {
  const response = await fetch(base + path, {
    headers: token ? { Authorization: "Bearer " + token } : {},
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `下载 ${path} 响应状态不符`);
  if (expected >= 400) return null;
  assert.match(response.headers.get("content-type"), /text\/csv/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition"), /attachment/);
  return response.text();
}

/** SQL 只进入隔离项目指定数据库，用于精确清理和核对未提交记录，不接受外部 SQL 配置。 */
function sql(statement) {
  assert(isolated, "只能操作独立验收数据库");
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      project,
      "-f",
      "compose.verify.yaml",
      "exec",
      "-T",
      database,
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --skip-column-names',
    ],
    { input: statement, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, "隔离验收 SQL 执行失败");
  return result.stdout.trim();
}

/** 仅将成功创建并登记的正整数 ID 放进清理语句，不允许宽泛条件删除或全表清理。 */
function identifiers(values) {
  assert(values.every((value) => Number.isSafeInteger(value) && value > 0));
  return [...new Set(values)].join(",") || "-1";
}

async function waitUntil(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("批量作业未在期限内完成");
}

test(
  "用户批量数据原子性、幂等与权限边界",
  { skip: !isolated },
  async (context) => {
    const admin = (
      await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
    ).token;
    const made = { users: [], roles: [], jobs: [] };
    const permissions = [
      "users:view",
      "users:create",
      "users:import",
      "users:export",
    ];
    async function account(label, scope, granted = permissions) {
      const role = await call("/system/roles", admin, "POST", {
        code: prefix + "_" + label,
        name: label,
        enabled: true,
        permissions: granted,
        dataScopes: { users: scope },
      });
      made.roles.push(role.id);
      const user = await call("/system/users", admin, "POST", {
        username: prefix + "_" + label,
        nickname: label,
        enabled: true,
        password,
        email: `${label}@bulk-private.example`,
        phone: "13000008888",
        roleIds: [role.id],
      });
      made.users.push(user.id);
      return {
        user,
        role,
        token: (await loginWithCaptcha(base, user.username, password)).token,
      };
    }
    async function finish(job, token) {
      made.jobs.push(job.id);
      let previous = 0;
      let completed;
      await waitUntil(async () => {
        completed = await call(`/bulk/jobs/${job.id}`, token);
        assert(completed.processedRows >= previous, "已处理数量应单调增加");
        assert(completed.processedRows <= completed.totalRows);
        previous = completed.processedRows;
        assert.notEqual(
          completed.status,
          "FAILED",
          "有效权限下的导出作业应成功",
        );
        return completed.status === "SUCCEEDED";
      });
      for (const forbidden of [
        "ownerId",
        "queryJson",
        "permissionSignature",
        "resultKey",
        "inputChecksum",
        "idempotencyKey",
      ])
        assert.equal(forbidden in completed, false, "内部作业字段不能进入 DTO");
      assert.equal(completed.processedRows, completed.totalRows);
      return completed;
    }
    try {
      const owner = await account("owner", "ALL");
      const outsider = await account("outside", "SELF", [
        "users:view",
        "users:export",
      ]);
      const scopedImporter = await account("scoped", "SELF");
      const delegatedImporter = await account("grant", "ALL", [
        ...permissions,
        "users:assign",
      ]);
      const header = "username,nickname,password,enabled";
      const validName = prefix + "_first";
      const secondName = prefix + "_second";
      const invalid = `${header}\n${validName},原子校验,${password},true\n${secondName},错误行,short,true\n`;
      const valid = `${header}\n${validName},=2+2,${password},true\n${secondName},第二位,${password},true\n`;

      await context.test(
        "模板按字段权限缩减，受限数据范围不能导入",
        async () => {
          const template = await download("/bulk/users/template", owner.token);
          assert.match(template, /username/);
          for (const forbidden of ["email", "phone", "departmentId", "roleIds"])
            assert.equal(template.includes(forbidden), false);
          await download("/bulk/users/template", undefined, 401);
          await download("/bulk/users/template", scopedImporter.token, 403);
          await upload("preview", scopedImporter.token, valid, undefined, 403);
          await call(
            "/bulk/com.example.AnyClass/template",
            owner.token,
            "GET",
            undefined,
            400,
          );
          const preview = await upload(
            "preview",
            owner.token,
            `username,nickname,password,email,roleIds\n${validName},越权字段,${password},private@example.com,1\n`,
          );
          assert.equal(preview.validRows, 0);
          assert(
            preview.rows[0].errors.some((error) => error.includes("邮箱")),
          );
          assert(
            preview.rows[0].errors.some((error) => error.includes("角色")),
          );
          const adminRole = (
            await call("/system/roles?keyword=admin&size=100", admin)
          ).items.find((role) => role.code === "admin");
          assert(adminRole);
          const elevated = await upload(
            "preview",
            delegatedImporter.token,
            `username,nickname,password,roleIds\n${validName},越级授权,${password},${adminRole.id}\n`,
          );
          assert.equal(elevated.validRows, 0);
          assert(
            elevated.rows[0].errors.some((error) => error.includes("委托权限")),
          );
        },
      );

      await context.test(
        "预览不回传密码，错误提交不会创建半批账号",
        async () => {
          const preview = await upload("preview", owner.token, invalid);
          assert.equal(preview.totalRows, 2);
          assert.equal(preview.validRows, 1);
          assert.equal(preview.rows[1].rowNumber, 3);
          assert(preview.rows[1].errors.length > 0);
          assert.equal(JSON.stringify(preview).includes(password), false);
          assert.equal(JSON.stringify(preview).includes("short"), false);
          await upload("commit", owner.token, invalid, randomUUID(), 400);
          assert.equal(
            (await call(`/system/users?keyword=${validName}`, admin)).total,
            0,
          );
          assert.equal(
            (await call(`/system/users?keyword=${secondName}`, admin)).total,
            0,
          );
          await upload(
            "preview",
            owner.token,
            "username,username\na,b\n",
            undefined,
            400,
          );
          await upload(
            "preview",
            owner.token,
            new Uint8Array([0xff]),
            undefined,
            400,
          );
        },
      );

      await context.test("提交原子保存，并发网络重试只创建一批", async () => {
        const preview = await upload("preview", owner.token, valid);
        assert.equal(preview.validRows, 2);
        const key = randomUUID();
        const results = await Promise.all([
          upload("commit", owner.token, valid, key),
          upload("commit", owner.token, valid, key),
        ]);
        assert.equal(results[0].jobId, results[1].jobId);
        assert.equal(results[0].importedRows, 2);
        made.jobs.push(results[0].jobId);
        assert(
          sql(
            `SELECT input_checksum FROM sys_bulk_job WHERE id IN (${identifiers([results[0].jobId])});`,
          ).startsWith("$2"),
          "含凭据文件的幂等校验值应采用带盐慢哈希",
        );
        for (const name of [validName, secondName]) {
          const users = await call(`/system/users?keyword=${name}`, admin);
          assert.equal(users.total, 1);
          const user = users.items[0];
          made.users.push(user.id);
          assert.equal(user.roleIds.length, 0, "导入不能自动给予角色");
        }
        await upload(
          "commit",
          owner.token,
          valid.replace("第二位", "变更文件"),
          key,
          400,
        );
        const repeated = await upload("preview", owner.token, valid);
        assert.equal(repeated.validRows, 0, "不同幂等键不得绕过用户名唯一约束");
        await call(
          `/bulk/jobs/${results[0].jobId}`,
          outsider.token,
          "GET",
          undefined,
          403,
        );
      });

      await context.test("异步导出进度、字段隔离与所有者隔离", async () => {
        const job = await call("/bulk/users/exports", owner.token, "POST", {
          keyword: prefix,
          enabled: null,
          departmentId: null,
        });
        const completed = await finish(job, owner.token);
        assert(completed.totalRows >= 5);
        const content = await download(
          `/bulk/jobs/${job.id}/download`,
          owner.token,
        );
        assert(content.includes(validName));
        assert.match(content, /"'=2\+2"/, "公式前缀应在 CSV 导出中中和");
        for (const forbidden of [
          "邮箱",
          "电话",
          "bulk-private.example",
          "13000008888",
          password,
        ])
          assert.equal(
            content.includes(forbidden),
            false,
            "导出不得泄漏未获授权字段",
          );
        await call(
          `/bulk/jobs/${job.id}`,
          outsider.token,
          "GET",
          undefined,
          403,
        );
        await download(`/bulk/jobs/${job.id}/download`, outsider.token, 403);
        await call(`/bulk/jobs/${job.id}`, admin, "GET", undefined, 403);
        await download(`/bulk/jobs/${job.id}/download`, admin, 403);
        const outsiderList = await call("/bulk/jobs", outsider.token);
        assert.equal(
          outsiderList.some((item) => item.id === job.id),
          false,
        );
        const selfJob = await call(
          "/bulk/users/exports",
          outsider.token,
          "POST",
          { keyword: prefix },
        );
        const own = await finish(selfJob, outsider.token);
        assert.equal(own.totalRows, 1);
        const ownContent = await download(
          `/bulk/jobs/${selfJob.id}/download`,
          outsider.token,
        );
        assert(ownContent.includes(outsider.user.username));
        assert.equal(ownContent.includes(validName), false);
        await call(`/system/roles/${owner.role.id}`, admin, "PUT", {
          ...owner.role,
          permissions: permissions.filter(
            (permission) => permission !== "users:export",
          ),
        });
        await call(`/bulk/jobs/${job.id}`, owner.token, "GET", undefined, 403);
        await download(`/bulk/jobs/${job.id}/download`, owner.token, 403);
      });
    } finally {
      // 网络响应丢失也可能已成功提交；只按本用例预先声明的精确用户名找回清理 ID。
      for (const name of [prefix + "_first", prefix + "_second"]) {
        const users = await call(
          `/system/users?keyword=${name}&size=100`,
          admin,
        );
        for (const user of users.items.filter((item) => item.username === name))
          made.users.push(user.id);
      }
      // 所有作业创建人都是本次新建并登记的账号，不会匹配原库账号的任务。
      const ownerIds = identifiers(made.users);
      const recoveredJobs = sql(
        `SELECT id FROM sys_bulk_job WHERE owner_id IN (${ownerIds});`,
      );
      if (recoveredJobs)
        made.jobs.push(...recoveredJobs.split(/\s+/).map(Number));
      // 先仅过期已登记作业，等服务定时任务删除正文和元数据，保留真实清理的可验收行为。
      const jobIds = identifiers(made.jobs);
      sql(
        `UPDATE sys_bulk_job SET expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id IN (${jobIds});`,
      );
      await waitUntil(
        () =>
          sql(`SELECT COUNT(*) FROM sys_bulk_job WHERE id IN (${jobIds});`) ===
          "0",
        75000,
      );
      for (const id of [...new Set(made.users)])
        await call(`/system/users/${id}`, admin, "DELETE");
      for (const id of made.roles)
        await call(`/system/roles/${id}`, admin, "DELETE");
      await call("/auth/logout", admin, "POST");
    }
  },
);
