import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { puzzleOffset } from "./captcha.mjs";

/** 用真实首因素和认证器验证码建立重启样本；不得把认证器共享密钥写入文件、日志或 URL。 */
function currentTotp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0,
    bits = 0;
  const bytes = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return String(
    (digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}

/**
 * 持久 MFA 的冷重启验收。仅接收独立 baseline 环境，不自行启动/停止服务。
 * restart(overrides) 必须在保存的原环境上覆盖指定变量，重启对应服务并等健康；空覆盖恢复原配置。
 * expectStartupFailure(overrides, expectedMessage) 必须确认新进程拒启且包含预期脱敏门禁原因。
 * 返回验证项摘要，不返回密码、认证器密钥、恢复码、令牌或完整环境。
 */
export async function verifyIdentityRestart({
  apiBase,
  adminPassword,
  project,
  database,
  restart,
  expectStartupFailure,
}) {
  assert(
    /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? ""),
    "MFA 重启验收只允许独立 baseline 项目",
  );
  assert(
    ["upgrade-db", "fresh-db"].includes(database),
    "MFA 重启验收只允许隔离数据库",
  );
  assert(apiBase && adminPassword, "重启验收缺少完整 API 或初始账号配置");
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(apiBase).hostname),
    "重启验收 API 只能是本机隔离端口",
  );
  assert.equal(typeof restart, "function");
  assert.equal(typeof expectStartupFailure, "function");
  const base = apiBase;
  const username = "qa_id_restart_" + randomBytes(5).toString("hex");
  const password = "IdentityRestart_" + randomBytes(12).toString("hex");
  let roleId,
    userId,
    mustRestore = false;
  // 阶段名称只来自本地常量；报告不包含请求正文、响应令牌、认证器秘密或恢复码。
  let stage = "准备独立账号",
    lastCall = null;
  const atStage = (name) => {
    stage = name;
    lastCall = null;
  };
  const failures = [];
  const rememberFailure = (failure) => {
    const detail = lastCall
      ? `；${lastCall.method} ${lastCall.route}，预期 ${lastCall.expectedStatus}，实际 ${lastCall.actualStatus ?? "无响应"}，类型 ${lastCall.kind}`
      : "；类型 " +
        (failure?.name === "AssertionError" ? "assertion" : "runtime");
    const recorded = new Error("持久 MFA 检查失败阶段：" + stage + detail);
    recorded.diagnostic = { stage, ...(lastCall ?? {}) };
    failures.push(recorded);
  };
  const request = async (path, token, method = "GET", body, expected = 200) => {
    // 路由仅由本函数常量及精确自建 ID 组成；不记录正文、响应消息或原始异常文本。
    lastCall = {
      method,
      route: path.replace(/\/(\d+)(?=\/|$)/g, "/:id"),
      expectedStatus: expected,
      actualStatus: null,
      kind: "network",
    };
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    lastCall.actualStatus = response.status;
    lastCall.kind = "status";
    assert.equal(
      response.status,
      expected,
      "MFA 重启验收接口状态不符合预期：" + path,
    );
    lastCall.kind = "response-format";
    const result = await response.json();
    lastCall.kind = "assertion";
    return result.data;
  };
  // 复用实际 PNG 的解题算法，逐次记录真实验证码及首因素调用；不跳过任何认证门禁。
  const login = async (account, passphrase, context) => {
    atStage(context + "：申请真实验证码");
    const puzzle = await request("/auth/captcha/challenge", null, "POST", {
      username: account,
    });
    await delay(350);
    atStage(context + "：验证真实拼图");
    const proof = await request("/auth/captcha/verify", null, "POST", {
      challengeId: puzzle.challengeId,
      username: account,
      x: puzzleOffset(puzzle),
      elapsedMs: 350,
    });
    atStage(context + "：验证账号密码");
    return request("/auth/login", null, "POST", {
      username: account,
      password: passphrase,
      captchaToken: proof.captchaToken,
    });
  };
  const adminLogin = async (context) =>
    (await login("admin", adminPassword, context)).token;
  const completeMfa = async (factor, context) => {
    const primary = await login(username, password, context);
    assert.equal(
      primary.mfaRequired,
      true,
      "已有 MFA 账号不能在冷重启或关闭新开通开关后降级为单因素登录",
    );
    assert(primary.token === null, "MFA 首因素不能返回业务令牌");
    atStage(context + "：验证既有 MFA 因素");
    const completed = await request("/auth/identity/mfa/verify", null, "POST", {
      challengeId: primary.challengeId,
      factor,
    });
    assert(completed.token);
    atStage(context + "：验证业务会话");
    await request("/auth/me", completed.token);
    return completed.token;
  };
  try {
    const admin = await adminLogin("准备独立账号：管理员登录");
    atStage("准备独立账号：创建独立角色");
    roleId = (
      await request("/system/roles", admin, "POST", {
        name: "MFA 重启验收",
        code: username + "_role",
        enabled: true,
        permissions: ["dashboard:view"],
        dataScopes: {},
      })
    ).id;
    atStage("准备独立账号：创建独立用户");
    userId = (
      await request("/system/users", admin, "POST", {
        username,
        nickname: "MFA 重启验收",
        password,
        enabled: true,
        roleIds: [roleId],
      })
    ).id;
    assert(Number.isSafeInteger(userId) && Number.isSafeInteger(roleId));
    const initial = (await login(username, password, "准备独立账号：用户登录"))
      .token;
    atStage("准备独立账号：开始 MFA 开通");
    const enrollment = await request(
      "/auth/identity/mfa/enroll",
      initial,
      "POST",
      { password },
    );
    atStage("准备独立账号：真实 TOTP 确认开通");
    const recovery = await request(
      "/auth/identity/mfa/confirm",
      initial,
      "POST",
      {
        challengeId: enrollment.challengeId,
        factor: currentTotp(enrollment.secret),
      },
    );
    assert.equal(recovery.length, 10);
    atStage("准备独立账号：确认旧会话已撤销");
    await request("/auth/me", initial, "GET", undefined, 401);

    atStage("正确密钥冷重启");
    mustRestore = true;
    await restart({});
    const correctKeySession = await completeMfa(recovery[0], "正确密钥冷重启");
    atStage("正确密钥冷重启：读取 MFA 状态");
    assert.equal(
      (await request("/auth/identity/mfa", correctKeySession)).enabled,
      true,
    );

    atStage("关闭新开通仍保护既有账号");
    await restart({ MAYDAY_MFA_ENABLED: "false" });
    const existingSession = await completeMfa(
      recovery[1],
      "关闭新开通仍保护既有账号",
    );
    atStage("关闭新开通仍保护既有账号：读取 MFA 状态");
    const status = await request("/auth/identity/mfa", existingSession);
    assert.equal(status.available, false);
    assert.equal(status.enabled, true);

    // 禁用所有可选身份入口来隔离持久凭据门禁，不能只证明“开启功能但缺配置”时的属性校验。
    const closed = {
      MAYDAY_MFA_ENABLED: "false",
      MAYDAY_IDENTITY_PROVIDERS_0_ENABLED: "false",
    };
    atStage("错误密钥拒绝启动");
    await expectStartupFailure(
      {
        ...closed,
        MAYDAY_IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      },
      "已有 MFA 凭据无法解密",
    );
    atStage("缺失密钥拒绝启动");
    await expectStartupFailure(
      { ...closed, MAYDAY_IDENTITY_ENCRYPTION_KEY: "" },
      "已有 MFA 凭据无法解密",
    );

    atStage("恢复原密钥及登录");
    await restart({});
    mustRestore = false;
    const restored = await completeMfa(recovery[2], "恢复原密钥及登录");
    atStage("恢复原密钥及登录：读取剩余恢复码数量");
    assert.equal(
      (await request("/auth/identity/mfa", restored)).recoveryCodesRemaining,
      7,
    );
  } catch (failure) {
    rememberFailure(failure);
  } finally {
    if (mustRestore) {
      try {
        atStage("故障后的原配置恢复");
        await restart({});
        mustRestore = false;
      } catch (failure) {
        rememberFailure(failure);
      }
    }
    // 只清理本函数通过 API 创建的精确账号/角色；不删库、不扫前缀，也不修改其他环境。
    if (!mustRestore && (userId || roleId)) {
      try {
        const admin = await adminLogin("精确清理：管理员登录");
        if (userId) {
          atStage("精确清理：删除自建用户");
          await request("/system/users/" + userId, admin, "DELETE");
        }
        if (roleId) {
          atStage("精确清理：删除自建角色");
          await request("/system/roles/" + roleId, admin, "DELETE");
        }
      } catch (failure) {
        rememberFailure(failure);
      }
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "持久 MFA 重启与密钥门禁验收失败：" +
        failures.map((failure) => failure.message).join("；"),
    );
  return {
    correctKeyRestart: true,
    enrollmentDisabledStillProtected: true,
    wrongKeyRejected: true,
    missingKeyRejected: true,
    restoredKeyLogin: true,
  };
}
