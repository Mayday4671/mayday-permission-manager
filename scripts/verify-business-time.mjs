/**
 * 固定上海业务墙上时间的真实跨 JVM 验收；本模块不启动进程，也不读取宿主数据库配置。
 * 调用方提供已隔离的 API、SQL 和重启句柄，始终使用同一冻结制品及同一数据库。
 * 业务 DATETIME 检查原始列值；安全会话 TIMESTAMP 检查 epoch，不能混用两个契约。
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";

const zones = Object.freeze(["UTC", "Asia/Shanghai"]);
const clockToleranceMs = 5000;
const stages = new Set([
  "准备隔离数据库",
  "UTC JVM 启动",
  "UTC JVM 真实管理员登录",
  "UTC JVM 创建固定墙上时间通知",
  "上海 JVM 读取 UTC 创建的通知和既有会话",
  "上海 JVM 创建固定墙上时间通知",
  "UTC JVM 读取上海创建的通知和既有会话",
  "恢复上海 JVM 配置",
  "恢复后复核原会话与 epoch",
  "取得自有草稿清理授权",
  "精确清理本次未发布通知",
  "撤销本次管理员登录会话",
]);
const routes = new Set([
  "/auth/me",
  "/auth/logout",
  "/operations/monitor",
  "/operations/notifications",
  "/operations/notifications/:id",
  "/operations/sessions/:session",
]);

/** 公开报告只投影白名单字段；即使传入带凭据的任意异常，也不展开 message/cause/原始值。 */
export function publicBusinessTimeFailure(failure) {
  const entries =
    failure instanceof AggregateError ? failure.errors : [failure];
  return {
    status: "failed",
    restored: failure?.diagnostic?.restored === true,
    cleanupSucceeded: failure?.diagnostic?.cleanupSucceeded === true,
    failures: entries.map((entry) => {
      const detail = entry?.diagnostic;
      const result = {
        stage: stages.has(detail?.stage) ? detail.stage : "UNKNOWN",
        kind: ["assertion", "runtime"].includes(detail?.kind)
          ? detail.kind
          : "runtime",
      };
      if (
        routes.has(detail?.route) &&
        ["GET", "POST", "DELETE"].includes(detail?.method)
      ) {
        result.route = detail.route;
        result.method = detail.method;
        result.expectedStatus = 200;
        result.actualStatus =
          Number.isInteger(detail.actualStatus) &&
          detail.actualStatus >= 100 &&
          detail.actualStatus <= 599
            ? detail.actualStatus
            : null;
      }
      return result;
    }),
  };
}

/** 接口允许省略零小数；统一到 MySQL DATETIME(6)，拒绝附带时区或不合法日期。 */
export function normalizeBusinessDateTime(value) {
  assert.equal(typeof value, "string", "业务时间必须是无时区字符串");
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(
    value,
  );
  assert(match, "业务时间必须符合 DATETIME(6) 墙上时间格式");
  const normalized = match[1] + "." + (match[2] ?? "").padEnd(6, "0");
  const epoch = Date.parse(normalized.slice(0, 23) + "+08:00");
  assert(
    Number.isFinite(epoch) &&
      new Date(epoch + 8 * 3600000).toISOString().slice(0, 19) === match[1],
    "业务时间包含不合法日期或时间",
  );
  return normalized;
}

/** 明确以上海 +08:00 解释墙上时间；不使用运行本验收脚本的宿主时区。 */
export function businessDateTimeEpoch(value) {
  return Date.parse(normalizeBusinessDateTime(value).slice(0, 23) + "+08:00");
}

/** 比较真实 GET 与原始 DATETIME，检测同 JVM 双向偏移互相抵消的假通过。 */
export function assertBusinessTimeSnapshot({
  api,
  stored,
  expected,
  createdBetween,
}) {
  for (const record of [api, stored]) {
    assert.equal(record.id, expected.id, "通知编号必须是本次自建编号");
    assert.equal(record.title, expected.title, "通知标题必须是本次独有标题");
    assert.equal(record.senderId, expected.senderId, "通知须属于本次管理员");
    assert.equal(record.status, "DRAFT", "验收通知只能是未发布草稿");
  }
  const snapshot = {};
  for (const field of ["expiresAt", "createdAt", "updatedAt"]) {
    snapshot[field] = normalizeBusinessDateTime(api[field]);
    assert.equal(
      snapshot[field],
      normalizeBusinessDateTime(stored[field]),
      "接口与原始 DATETIME 不一致：" + field,
    );
  }
  assert.equal(
    snapshot.expiresAt,
    normalizeBusinessDateTime(expected.expiresAt),
    "固定过期墙上时间不能随 JVM 时区发生偏移",
  );
  assert(
    Array.isArray(createdBetween) &&
      createdBetween.length === 2 &&
      createdBetween.every(Number.isSafeInteger) &&
      createdBetween[0] <= createdBetween[1],
    "创建时间须有可信请求起止时间点",
  );
  const createdEpoch = businessDateTimeEpoch(snapshot.createdAt);
  assert(
    createdEpoch >= createdBetween[0] - clockToleranceMs &&
      createdEpoch <= createdBetween[1] + clockToleranceMs,
    "BaseEntity 创建时间须接近请求时的上海业务时间",
  );
  return snapshot;
}

/** 安全时间点保留 epoch；请求活跃时间可以推进，但固定创建和到期时间不能改变。 */
export function assertSessionEpoch({ stored, expected, createdBetween }) {
  assert(
    stored &&
      [stored.createdEpoch, stored.expiresEpoch].every(Number.isSafeInteger) &&
      stored.expiresEpoch > stored.createdEpoch,
    "安全会话必须有可信绝对创建和到期时间点",
  );
  if (expected) {
    assert.equal(
      stored.createdEpoch,
      expected.createdEpoch,
      "跨 JVM 重启不能改变会话创建 epoch",
    );
    assert.equal(
      stored.expiresEpoch,
      expected.expiresEpoch,
      "跨 JVM 重启不能改变会话固定到期 epoch",
    );
  } else {
    assert(
      createdBetween?.length === 2 &&
        createdBetween.every(Number.isSafeInteger) &&
        createdBetween[0] <= createdBetween[1] &&
        stored.createdEpoch >= createdBetween[0] - clockToleranceMs &&
        stored.createdEpoch <= createdBetween[1] + clockToleranceMs,
      "安全会话创建 epoch 须接近真实登录时间点",
    );
  }
  return {
    createdEpoch: stored.createdEpoch,
    expiresEpoch: stored.expiresEpoch,
  };
}

/**
 * restart(timeZone) 接收且只接收 UTC/Asia/Shanghai，重启隔离 fresh 服务并等健康。
 * sql(statement) 是绑定指定项目/数据库的受控回调，返回无列名的单个 JSON 单元。
 * finally 恢复 Asia/Shanghai，精确删除自己的未发布通知并撤销自己的登录；保留正常审计。
 * 返回值和失败诊断仅含固定检查名称、阶段、HTTP 状态和时区，不含令牌或数据库原始值。
 */
export async function verifyBusinessTime({
  apiBase,
  adminPassword,
  project,
  database,
  restart,
  sql,
}) {
  assert(
    /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? ""),
    "业务时区验收只允许独立 baseline 项目",
  );
  assert.equal(database, "fresh-db", "业务时区验收只允许隔离 fresh 数据库");
  let address;
  try {
    address = new URL(apiBase);
  } catch {
    assert.fail("业务时区验收需要合法的隔离 API 地址");
  }
  assert(
    address.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) &&
      Number(address.port) > 0 &&
      address.pathname === "/api" &&
      !address.username &&
      !address.password &&
      !address.search &&
      !address.hash,
    "业务时区验收 API 须为本机显式端口和 /api 路径",
  );
  assert(
    typeof adminPassword === "string" && adminPassword.length > 0,
    "业务时区验收缺少管理员配置",
  );
  assert.equal(typeof restart, "function", "必须提供受控重启句柄");
  assert.equal(typeof sql, "function", "必须提供隔离 SQL 句柄");

  const prefix =
    "qa_business_time_" +
    Date.now().toString(36) +
    randomBytes(4).toString("hex");
  const titles = [prefix + "_utc", prefix + "_shanghai"];
  // SQL 文本只插入本地随机标识、固定标题和已核验的安全整数；不接受接口正文或凭据。
  assert(
    titles.every((title) => /^qa_business_time_[a-z0-9]+_[a-z]+$/.test(title)),
  );
  const titleList = titles.map((title) => "'" + title + "'").join(",");
  let stage = "准备隔离数据库",
    lastCall = null,
    token,
    tokenHash,
    senderId,
    session,
    mustRestore = false,
    cleanupSucceeded = true,
    restored = false;
  const failures = [],
    checks = [];
  const atStage = (name) => {
    stage = name;
    lastCall = null;
  };
  const rememberFailure = (failure) => {
    const diagnostic = {
      stage,
      kind: failure?.name === "AssertionError" ? "assertion" : "runtime",
      ...(lastCall ?? {}),
    };
    const recorded = new Error("业务时区验收失败阶段：" + stage);
    recorded.diagnostic = diagnostic;
    failures.push(recorded);
  };
  const request = async (path, method = "GET", body, bearer = token) => {
    lastCall = {
      method,
      route: path
        .replace(/\/(\d+)(?=\/|$)/g, "/:id")
        .replace(/\/[a-f0-9-]{36}$/, "/:session"),
      expectedStatus: 200,
      actualStatus: null,
    };
    const response = await fetch(apiBase + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + bearer,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    lastCall.actualStatus = response.status;
    assert.equal(response.status, 200, "业务时区验收接口状态不符合预期");
    return (await response.json()).data;
  };
  const jsonSql = async (statement) => {
    lastCall = null;
    const result = await sql(statement);
    assert.equal(
      typeof result,
      "string",
      "隔离 SQL 必须返回单个 JSON 单元文本",
    );
    return JSON.parse(result.trim());
  };
  const readSession = () =>
    jsonSql(
      `SELECT JSON_OBJECT('createdEpoch',CAST(UNIX_TIMESTAMP(created_at)*1000 AS UNSIGNED),'expiresEpoch',CAST(UNIX_TIMESTAMP(expires_at)*1000 AS UNSIGNED)) FROM sys_session WHERE token_hash='${tokenHash}' AND user_id=${senderId};`,
    );
  const assertExistingSession = async () => {
    const me = await request("/auth/me");
    assert.equal(me.user.id, senderId, "重启后原会话须仍是同一管理员");
    assertSessionEpoch({ stored: await readSession(), expected: session });
  };
  const assertRuntimeZone = async (expectedZone) => {
    const monitor = await request("/operations/monitor");
    assert.equal(
      monitor.timezone,
      expectedZone,
      "真实 JVM 时区须等于重启请求的时区",
    );
  };
  const readNotification = async (expected, createdBetween) => {
    const api = await request("/operations/notifications/" + expected.id);
    const stored = await jsonSql(
      `SELECT JSON_OBJECT('id',id,'title',title,'senderId',sender_id,'status',status,'createdAt',DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),'updatedAt',DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%f'),'expiresAt',DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%f')) FROM ops_notification WHERE id=${expected.id} AND sender_id=${senderId} AND title='${expected.title}';`,
    );
    return assertBusinessTimeSnapshot({
      api,
      stored,
      expected,
      createdBetween,
    });
  };
  const createNotification = async (title, expiresAt) => {
    const startedAt = Date.now();
    const created = await request("/operations/notifications", "POST", {
      title,
      summary: "隔离时区验收草稿",
      content: "<p>跨 JVM 固定墙上时间验收，未发布。</p>",
      type: "NOTICE",
      recipientType: "USERS",
      recipientIds: [senderId],
      attachmentIds: [],
      expiresAt,
    });
    const createdBetween = [startedAt, Date.now()];
    assert(
      Number.isSafeInteger(created.id) && created.id > 0,
      "通知编号须为安全整数",
    );
    const expected = { id: created.id, title, senderId, expiresAt };
    // 首次 POST 的实体尚可含纳秒；用独立 GET 与 DATETIME(6) 比较真实持久化结果。
    const snapshot = await readNotification(expected, createdBetween);
    return { expected, createdBetween, snapshot };
  };
  const check = (name) => checks.push({ name, status: "passed" });
  const cleanup = async (name, action) => {
    atStage(name);
    try {
      await action();
    } catch (failure) {
      cleanupSucceeded = false;
      rememberFailure(failure);
    }
  };

  try {
    assert.equal(
      await jsonSql("SELECT JSON_QUOTE(DATABASE());"),
      "mayday_verify",
      "SQL 须绑定固定隔离验收库",
    );
    atStage("UTC JVM 启动");
    mustRestore = true;
    await restart("UTC");
    atStage("UTC JVM 真实管理员登录");
    const loginStarted = Date.now();
    const login = await loginWithCaptcha(apiBase, "admin", adminPassword);
    assert(
      typeof login.token === "string" && login.token.length > 0,
      "需要真实业务会话",
    );
    token = login.token;
    tokenHash = createHash("sha256").update(token).digest("hex");
    const loginFinished = Date.now();
    senderId = (await request("/auth/me")).user.id;
    assert(
      Number.isSafeInteger(senderId) && senderId > 0,
      "管理员编号须为安全整数",
    );
    session = assertSessionEpoch({
      stored: await readSession(),
      createdBetween: [loginStarted, loginFinished],
    });
    await assertRuntimeZone("UTC");
    check("SESSION_CREATED_AT_EPOCH");

    atStage("UTC JVM 创建固定墙上时间通知");
    const utc = await createNotification(
      titles[0],
      "2099-10-05T14:23:45.123456",
    );
    check("UTC_CREATE_DATETIME");
    check("UTC_CREATED_AT_SHANGHAI");

    atStage("上海 JVM 读取 UTC 创建的通知和既有会话");
    await restart("Asia/Shanghai");
    await assertRuntimeZone("Asia/Shanghai");
    await assertExistingSession();
    assert.deepEqual(
      await readNotification(utc.expected, utc.createdBetween),
      utc.snapshot,
      "UTC 创建的原始墙上时间须在上海 JVM 完整保持",
    );
    check("UTC_TO_SHANGHAI_READ");

    atStage("上海 JVM 创建固定墙上时间通知");
    const shanghai = await createNotification(
      titles[1],
      "2099-10-06T15:24:46.654321",
    );
    check("SHANGHAI_CREATE_DATETIME");
    check("SHANGHAI_CREATED_AT_SHANGHAI");

    atStage("UTC JVM 读取上海创建的通知和既有会话");
    await restart("UTC");
    await assertRuntimeZone("UTC");
    await assertExistingSession();
    for (const fixture of [utc, shanghai])
      assert.deepEqual(
        await readNotification(fixture.expected, fixture.createdBetween),
        fixture.snapshot,
        "跨 JVM 重启不能改变既有通知的创建、更新或过期墙上时间",
      );
    check("SHANGHAI_TO_UTC_READ");
    check("SESSION_EPOCH_PRESERVED");
    check("JVM_RUNTIME_ZONES");
  } catch (failure) {
    rememberFailure(failure);
  } finally {
    if (mustRestore)
      await cleanup("恢复上海 JVM 配置", async () => {
        await restart("Asia/Shanghai");
        restored = true;
      });
    if (session && restored)
      await cleanup("恢复后复核原会话与 epoch", async () => {
        await assertRuntimeZone("Asia/Shanghai");
        await assertExistingSession();
      });
    if (token) {
      // 验收失败不能阻止清理；仅为清理重登，不用新会话替代上述重启后原会话断言。
      let cleanupToken = token;
      await cleanup("取得自有草稿清理授权", async () => {
        try {
          await request("/auth/me");
        } catch {
          const login = await loginWithCaptcha(apiBase, "admin", adminPassword);
          assert(typeof login.token === "string" && login.token.length > 0);
          cleanupToken = login.token;
        }
      });
      if (Number.isSafeInteger(senderId) && senderId > 0) {
        await cleanup("精确清理本次未发布通知", async () => {
          // 固定两个随机标题 + 发件人定位；即便 POST 已提交后断开，也能找到自己的草稿。
          const owned = await jsonSql(
            `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id,'title',title)),JSON_ARRAY()) FROM ops_notification WHERE sender_id=${senderId} AND title IN (${titleList});`,
          );
          assert(Array.isArray(owned), "自有通知查询须返回数组");
          for (const item of owned) {
            assert(
              Number.isSafeInteger(item.id) &&
                item.id > 0 &&
                titles.includes(item.title),
              "清理只允许本次精确自建通知",
            );
            const record = await request(
              "/operations/notifications/" + item.id,
              "GET",
              undefined,
              cleanupToken,
            );
            assert.equal(record.title, item.title, "清理前须复核通知标题");
            assert.equal(record.senderId, senderId, "清理前须复核发件人");
            assert.equal(
              record.status,
              "DRAFT",
              "不得自动撤回或删除非草稿记录",
            );
            await request(
              "/operations/notifications/" + item.id,
              "DELETE",
              undefined,
              cleanupToken,
            );
          }
          assert.equal(
            await jsonSql(
              `SELECT COUNT(*) FROM ops_notification WHERE sender_id=${senderId} AND title IN (${titleList});`,
            ),
            0,
            "本次自建通知必须全部清理",
          );
        });
      }
      await cleanup("撤销本次管理员登录会话", async () => {
        // 清理重登不会替代测试会话。仅用旧 token 的摘要定位自己的会话 ID，通过正常下线接口撤销。
        if (cleanupToken !== token) {
          const previous = await jsonSql(
            `SELECT JSON_OBJECT('sessionId',(SELECT session_id FROM sys_session WHERE token_hash='${tokenHash}'));`,
          );
          if (previous.sessionId !== null) {
            assert(
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
                previous.sessionId,
              ),
              "只允许撤销自己的可信会话编号",
            );
            await request(
              "/operations/sessions/" + previous.sessionId,
              "DELETE",
              undefined,
              cleanupToken,
            );
          }
        }
        await request("/auth/logout", "POST", undefined, cleanupToken);
        const cleanupHash = createHash("sha256")
          .update(cleanupToken)
          .digest("hex");
        assert.equal(
          await jsonSql(
            `SELECT COUNT(*) FROM sys_session WHERE token_hash IN ('${tokenHash}','${cleanupHash}');`,
          ),
          0,
          "本次管理员会话须已全部撤销",
        );
      });
    }
  }
  if (failures.length) {
    const failure = new AggregateError(failures, "固定业务时区真实验收未通过");
    failure.diagnostic = { cleanupSucceeded, restored };
    throw failure;
  }
  return {
    status: "passed",
    checks,
    zones: [...zones],
    restored,
    cleanupSucceeded,
  };
}
