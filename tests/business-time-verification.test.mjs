/** 验收助手的纯回归：不启动 Java/Docker、不连接数据库、不执行真实登录或 API。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBusinessDateTime,
  businessDateTimeEpoch,
  assertBusinessTimeSnapshot,
  assertSessionEpoch,
  publicBusinessTimeFailure,
  verifyBusinessTime,
} from "../scripts/verify-business-time.mjs";

const createdAt = "2026-10-05T14:23:45.123456";
const createdEpoch = Date.parse("2026-10-05T06:23:45.123Z");
const expected = {
  id: 12,
  title: "qa_business_time_abc_utc",
  senderId: 1,
  expiresAt: "2099-10-05T14:23:45.123456",
};
const api = {
  ...expected,
  status: "DRAFT",
  createdAt,
  updatedAt: "2026-10-05T14:23:45.125",
};
const stored = { ...api, updatedAt: "2026-10-05T14:23:45.125000" };
const createdBetween = [createdEpoch - 20, createdEpoch + 50];

test("业务墙上时间按 DATETIME(6) 规范化并固定以 +08:00 解释", () => {
  assert.equal(
    normalizeBusinessDateTime("2026-10-05T14:23:45"),
    "2026-10-05T14:23:45.000000",
  );
  assert.equal(
    normalizeBusinessDateTime("2026-10-05T14:23:45.125"),
    stored.updatedAt,
  );
  assert.equal(normalizeBusinessDateTime(createdAt), createdAt);
  assert.equal(businessDateTimeEpoch(createdAt), createdEpoch);
  assert.equal(
    businessDateTimeEpoch("2024-02-29T00:00:00"),
    Date.parse("2024-02-28T16:00:00Z"),
  );
});

test("业务时间拒绝隐式时区、超出 MySQL 精度和无效日历值", () => {
  for (const value of [
    createdAt + "Z",
    createdAt + "+08:00",
    "2026-10-05T14:23:45.1234567",
    "2026-02-29T14:23:45",
    "2026-10-05T24:23:45",
    "2026-10-05T14:23:60",
    "2026-13-05T14:23:45",
    "2026-10-05 14:23:45",
    null,
  ])
    assert.throws(() => normalizeBusinessDateTime(value));
});

test("真实 GET 与数据库微秒相等，上海创建时间接近请求 epoch 才通过", () => {
  assert.deepEqual(
    assertBusinessTimeSnapshot({ api, stored, expected, createdBetween }),
    {
      createdAt,
      updatedAt: stored.updatedAt,
      expiresAt: expected.expiresAt,
    },
  );
});

test("同 JVM 读写偏移抵消仍被原始 DATETIME 和 BaseEntity 时间门禁拒绝", () => {
  assert.throws(
    () =>
      assertBusinessTimeSnapshot({
        api,
        stored: { ...stored, expiresAt: "2099-10-05T22:23:45.123456" },
        expected,
        createdBetween,
      }),
    /原始 DATETIME 不一致/,
  );
  for (const wrongCreatedAt of [
    "2026-10-05T06:23:45.123456",
    "2026-10-05T22:23:45.123456",
  ])
    assert.throws(
      () =>
        assertBusinessTimeSnapshot({
          api: { ...api, createdAt: wrongCreatedAt },
          stored: { ...stored, createdAt: wrongCreatedAt },
          expected,
          createdBetween,
        }),
      /BaseEntity 创建时间/,
    );
});

test("拒绝错误通知、非自有发件人、已发布状态和双方一致的过期时间偏移", () => {
  for (const difference of [
    { id: 13 },
    { title: "another" },
    { senderId: 2 },
    { status: "PUBLISHED" },
    { expiresAt: "2099-10-05T22:23:45.123456" },
  ])
    assert.throws(() =>
      assertBusinessTimeSnapshot({
        api: { ...api, ...difference },
        stored: { ...stored, ...difference },
        expected,
        createdBetween,
      }),
    );
});

test("安全会话保持创建及固定到期 epoch，拒绝双向八小时偏移和延期", () => {
  const session = {
    createdEpoch,
    expiresEpoch: createdEpoch + 12 * 3600000,
  };
  assert.deepEqual(
    assertSessionEpoch({ stored: session, createdBetween }),
    session,
  );
  assert.deepEqual(
    assertSessionEpoch({ stored: session, expected: session }),
    session,
  );
  for (const offset of [-8 * 3600000, 8 * 3600000]) {
    const shifted = {
      createdEpoch: session.createdEpoch + offset,
      expiresEpoch: session.expiresEpoch + offset,
    };
    assert.throws(() =>
      assertSessionEpoch({ stored: shifted, createdBetween }),
    );
    assert.throws(() =>
      assertSessionEpoch({ stored: shifted, expected: session }),
    );
  }
  assert.throws(() =>
    assertSessionEpoch({
      stored: { ...session, expiresEpoch: session.expiresEpoch + 1000 },
      expected: session,
    }),
  );
  assert.throws(() =>
    assertSessionEpoch({
      stored: { createdEpoch, expiresEpoch: createdEpoch },
    }),
  );
});

test("参数门禁先于 SQL、API 或重启，拒绝日常项目和非隔离地址", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", () =>
    assert.fail("参数拒绝后不得访问 API"),
  );
  const options = {
    apiBase: "http://127.0.0.1:18001/api",
    adminPassword: "not-a-real-password",
    project: "mayday-check-20261005000000-abcdef",
    database: "fresh-db",
    restart: async () => assert.fail("参数拒绝后不得重启"),
    sql: () => assert.fail("参数拒绝后不得执行 SQL"),
  };
  try {
    for (const difference of [
      { project: "mayday" },
      { database: "upgrade-db" },
      { apiBase: "http://example.org:18001/api" },
      { apiBase: "http://127.0.0.1/api" },
      { apiBase: "http://127.0.0.1:18001/api?token=private" },
      { adminPassword: "" },
      { restart: undefined },
      { sql: undefined },
    ])
      await assert.rejects(verifyBusinessTime({ ...options, ...difference }));
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
  }
});

test("公开时区失败报告仅保留白名单诊断，拒绝任意阶段、路由或原始密钥", () => {
  const privateValue = "PRIVATE_BUSINESS_TIME_CANARY";
  const fixed = new Error(privateValue, { cause: new Error(privateValue) });
  fixed.diagnostic = {
    stage: "UTC JVM 创建固定墙上时间通知",
    kind: "assertion",
    method: "POST",
    route: "/operations/notifications",
    expectedStatus: privateValue,
    actualStatus: 400,
    secret: privateValue,
  };
  const untrusted = new Error(privateValue);
  untrusted.diagnostic = {
    stage: privateValue,
    kind: privateValue,
    method: "GET",
    route: "/auth/me?token=" + privateValue,
  };
  const error = new AggregateError([fixed, untrusted], privateValue);
  error.diagnostic = {
    restored: true,
    cleanupSucceeded: false,
    secret: privateValue,
  };
  const result = publicBusinessTimeFailure(error);
  assert.deepEqual(result, {
    status: "failed",
    restored: true,
    cleanupSucceeded: false,
    failures: [
      {
        stage: "UTC JVM 创建固定墙上时间通知",
        kind: "assertion",
        method: "POST",
        route: "/operations/notifications",
        expectedStatus: 200,
        actualStatus: 400,
      },
      { stage: "UNKNOWN", kind: "runtime" },
    ],
  });
  assert(!JSON.stringify(result).includes(privateValue));
});

test("重启或认证异常仍恢复上海，公开诊断不包含凭据或原始错误", async (t) => {
  const privateValue = "PRIVATE_BUSINESS_TIME_CANARY";
  for (const failRestart of [true, false]) {
    const restarted = [];
    let sqlCalls = 0;
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error(privateValue);
    });
    try {
      await assert.rejects(
        verifyBusinessTime({
          apiBase: "http://127.0.0.1:18001/api",
          adminPassword: privateValue,
          project: "mayday-check-20261005000000-abcdef",
          database: "fresh-db",
          restart: async (zone) => {
            restarted.push(zone);
            if (zone === "UTC" && failRestart) throw new Error(privateValue);
          },
          sql: () => {
            sqlCalls++;
            return JSON.stringify("mayday_verify");
          },
        }),
        (failure) => {
          assert(failure instanceof AggregateError);
          assert.equal(failure.errors.length, 1);
          assert.deepEqual(failure.diagnostic, {
            cleanupSucceeded: true,
            restored: true,
          });
          const publicDiagnostic = JSON.stringify({
            message: failure.message,
            errors: failure.errors.map((error) => ({
              message: error.message,
              diagnostic: error.diagnostic,
            })),
          });
          assert(!publicDiagnostic.includes(privateValue));
          return true;
        },
      );
      assert.deepEqual(restarted, ["UTC", "Asia/Shanghai"]);
      assert.equal(sqlCalls, 1);
      assert.equal(fetchMock.mock.callCount(), failRestart ? 0 : 1);
    } finally {
      fetchMock.mock.restore();
    }
  }
});
