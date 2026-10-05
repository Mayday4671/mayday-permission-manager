/** 企业身份真实 HTTP/MySQL 验收：只在独立验收项目运行，协议提供商也只监听 loopback。 */
import { isolatedSql } from "./support/isolated-compose.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { loginWithCaptcha } from "./support/captcha.mjs";

const base = process.env.API_BASE,
  project = process.env.API_TEST_COMPOSE_PROJECT,
  database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database);
const prefix = "qa_identity_" + Date.now().toString(36),
  password = "IdentityQa_2026!";
const issuer = "http://127.0.0.1:18390",
  clientId = "mayday-qa",
  clientSecret = process.env.MAYDAY_IDENTITY_PROVIDERS_0_CLIENTSECRET;
const created = { users: [], roles: [] };
const digest = (value) => createHash("sha256").update(value).digest("hex");
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "qa-rotation",
  use: "sig",
  alg: "RS256",
};
const codes = new Map();
let subject = "qa-subject-" + prefix,
  mode = "valid",
  exchanges = 0;
const provider = createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  if (url.pathname === "/authorize") {
    assert.equal(url.searchParams.get("client_id"), clientId);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "openid");
    const code = randomUUID();
    codes.set(code, {
      nonce: url.searchParams.get("nonce"),
      challenge: url.searchParams.get("code_challenge"),
      redirect: url.searchParams.get("redirect_uri"),
      subject,
      mode,
    });
    const target = new URL(url.searchParams.get("redirect_uri"));
    target.searchParams.set("code", code);
    target.searchParams.set("state", url.searchParams.get("state"));
    res.writeHead(302, { Location: target.href });
    res.end();
    return;
  }
  if (url.pathname === "/jwks") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: [publicJwk] }));
    return;
  }
  if (url.pathname === "/token") {
    let text = "";
    for await (const part of req) text += part;
    const body = new URLSearchParams(text),
      pending = codes.get(body.get("code"));
    codes.delete(body.get("code"));
    exchanges++;
    if (
      !pending ||
      req.headers.authorization !==
        "Basic " +
          Buffer.from(clientId + ":" + clientSecret).toString("base64") ||
      createHash("sha256")
        .update(body.get("code_verifier") ?? "")
        .digest("base64url") !== pending.challenge ||
      body.get("redirect_uri") !== pending.redirect
    ) {
      res.writeHead(400);
      res.end('{"error":"invalid_grant"}');
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: pending.mode === "issuer" ? "https://attacker.invalid" : issuer,
      sub: pending.subject,
      aud: pending.mode === "audience" ? "another-client" : clientId,
      nonce: pending.mode === "nonce" ? "unrelated" : pending.nonce,
      iat: now,
      exp: pending.mode === "expired" ? now - 120 : now + 300,
      email: "admin@mayday.example",
      roles: ["admin"],
      preferred_username: "admin",
    };
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "qa-rotation" }),
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url"),
      input = header + "." + payload;
    let signature = sign("RSA-SHA256", Buffer.from(input), privateKey).toString(
      "base64url",
    );
    if (pending.mode === "signature")
      signature =
        (signature.startsWith("A") ? "B" : "A") + signature.substring(1);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id_token: input + "." + signature,
        access_token: "external-only-token",
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

function sql(statement) {
  assert(isolated, "SQL 仅允许本次独立验收项目");
  return isolatedSql(statement, { maxBuffer: 2e6 }).trim();
}
async function call(path, token, method = "GET", body, expected = 200, cookie) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const envelope = await response.json();
  assert.equal(response.status, expected, path + " " + envelope.message);
  return { data: envelope.data, response };
}
async function authorization(token, binding = false, extra = {}) {
  const started = await call(
    binding ? "/auth/identity/oidc/bind" : "/auth/identity/oidc/start",
    token,
    "POST",
    { providerId: "qa-identity", ...(binding ? { password } : {}), ...extra },
  );
  const cookie = started.response.headers.get("set-cookie");
  assert(cookie?.includes("HttpOnly"));
  assert(cookie.includes("SameSite=Lax"));
  const visited = await fetch(started.data.authorizationUrl, {
    redirect: "manual",
  });
  assert.equal(visited.status, 302);
  const result = new URL(visited.headers.get("location"));
  return {
    state: result.searchParams.get("state"),
    code: result.searchParams.get("code"),
    cookie: cookie.split(";")[0],
  };
}
const complete = (pending, token, expected = 200, cookie = pending.cookie) =>
  call(
    "/auth/identity/oidc/complete",
    token,
    "POST",
    { state: pending.state, code: pending.code },
    expected,
    cookie,
  );
const rawLogin = async (user) =>
  await loginWithCaptcha(base, user.username, password);
async function mfaLogin(user, factor) {
  const primary = await rawLogin(user);
  assert.equal(primary.mfaRequired, true);
  assert.equal(primary.token, null);
  return (
    await call("/auth/identity/mfa/verify", null, "POST", {
      challengeId: primary.challengeId,
      factor,
    })
  ).data.token;
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0,
    bits = 0;
  const bytes = [];
  for (const item of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(item);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  const step = BigInt(Math.floor(Date.now() / 30000)),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const value = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(),
    offset = value.at(-1) & 15;
  return String((value.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

test("完整企业身份与 MFA 真实业务验收（没有配置不视为通过）", async (t) => {
  assert(isolated && base, "身份测试必须由隔离基线启动，不能跳过或指向日常库");
  assert(
    clientSecret,
    "身份协议测试必须使用隔离基线注入的随机 OIDC 客户端秘密",
  );
  const publicProviders = (await call("/auth/identity/providers")).data;
  assert(
    publicProviders.some((item) => item.id === "qa-identity"),
    "隔离基线必须注册 qa-identity loopback 提供方",
  );
  assert(!JSON.stringify(publicProviders).includes(clientSecret));
  await new Promise((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(18390, "127.0.0.1", resolve);
  });
  let admin, a, b, limited;
  try {
    admin = (await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD))
      .token;
    const makeRole = async (name, permissions) => {
      const role = (
        await call("/system/roles", admin, "POST", {
          name,
          code: prefix + "_role_" + created.roles.length,
          enabled: true,
          permissions,
          dataScopes: { users: "SELF" },
        })
      ).data;
      created.roles.push(role.id);
      return role;
    };
    const basic = await makeRole("普通成员", [
      "dashboard:view",
      "messages:view",
    ]);
    const limitedRole = await makeRole("本人管理者", [
      "dashboard:view",
      "messages:view",
      "users:view",
      "users:reset",
    ]);
    const makeUser = async (name, role) => {
      const user = (
        await call("/system/users", admin, "POST", {
          username: prefix + "_" + name,
          nickname: name,
          password,
          enabled: true,
          roleIds: [role.id],
        })
      ).data;
      created.users.push(user.id);
      return { ...user, token: (await rawLogin(user)).token };
    };
    a = await makeUser("a", basic);
    b = await makeUser("b", basic);
    limited = await makeUser("limited", limitedRole);
    assert.equal(
      (await call("/auth/identity/mfa", a.token)).data.available,
      true,
      "基线必须开启 MFA 并注入随机独立 key",
    );

    await t.test("企业身份未绑定不建号、不按管理员邮箱或角色扩权", async () => {
      const count = sql("select count(*) from sys_user;");
      const started = await authorization();
      await complete(started, null, 400);
      assert.equal(sql("select count(*) from sys_user;"), count);
    });
    await t.test(
      "绑定必须本人密码及同一仍有效会话，cookie/state不能跨浏览器",
      async () => {
        await call(
          "/auth/identity/oidc/bind",
          null,
          "POST",
          { providerId: "qa-identity", password },
          401,
        );
        await call(
          "/auth/identity/oidc/bind",
          a.token,
          "POST",
          { providerId: "qa-identity", password: "wrong" },
          400,
        );
        const started = await authorization(a.token, true);
        const before = exchanges;
        await complete(started, b.token, 400);
        await complete(started, a.token, 400, "mayday.oidc=foreign-cookie");
        assert.equal(exchanges, before);
        assert.equal((await complete(started, a.token)).data.bound, true);
        await complete(started, a.token, 400);
        assert.equal(
          (await call("/auth/identity/bindings", a.token)).data.length,
          1,
        );
        assert.equal(
          (await call("/auth/identity/bindings", b.token)).data.length,
          0,
        );
        const audit = sql(
          `select changes_json from sys_change_audit where resource='用户' and resource_id=${a.id} and action='绑定企业登录';`,
        );
        assert(audit.includes("企业登录"));
        assert(
          !audit.includes(subject) &&
            !audit.includes(password) &&
            !audit.includes(clientSecret),
        );
      },
    );
    await t.test(
      "已证明企业主体只恢复本地账号，外部 admin 声明不授予后台权限",
      async () => {
        const result = (await complete(await authorization())).data;
        assert(result.login.token);
        const me = (await call("/auth/me", result.login.token)).data;
        assert.equal(me.user.id, a.id);
        assert.equal(me.admin, false);
        assert(!me.permissions.includes("users:reset"));
        await call("/system/users", result.login.token, "GET", undefined, 403);
      },
    );
    await t.test(
      "真实提供方错误 issuer/audience/nonce/到期/签名全部拒绝",
      async () => {
        for (const value of [
          "issuer",
          "audience",
          "nonce",
          "expired",
          "signature",
        ]) {
          mode = value;
          const pending = await authorization();
          await complete(pending, null, 400);
          await complete(pending, null, 400);
        }
        mode = "valid";
      },
    );
    await t.test(
      "过期 OIDC state 在交换 code 之前拒绝，错误不会向提供方泄露授权码",
      async () => {
        const pending = await authorization();
        sql(
          `update sys_identity_challenge set expires_at=date_sub(current_timestamp(3),interval 1 second) where token_hash='${digest(pending.state)}';`,
        );
        const before = exchanges;
        await complete(pending, null, 400);
        assert.equal(exchanges, before);
      },
    );
    let enrollment, recovery;
    await t.test(
      "扫码不算开通，真实验证码确认后撤销旧会话，密钥只加密保存",
      async () => {
        enrollment = (
          await call("/auth/identity/mfa/enroll", a.token, "POST", { password })
        ).data;
        assert.equal(
          (await call("/auth/identity/mfa", a.token)).data.enabled,
          false,
        );
        await call(
          "/auth/identity/mfa/confirm",
          b.token,
          "POST",
          {
            challengeId: enrollment.challengeId,
            factor: totp(enrollment.secret),
          },
          400,
        );
        recovery = (
          await call("/auth/identity/mfa/confirm", a.token, "POST", {
            challengeId: enrollment.challengeId,
            factor: totp(enrollment.secret),
          })
        ).data;
        assert.equal(recovery.length, 10);
        assert.equal(new Set(recovery).size, 10);
        await call("/auth/me", a.token, "GET", undefined, 401);
        assert(
          !sql(
            `select secret_cipher from sys_mfa_credential where user_id=${a.id};`,
          ).includes(enrollment.secret),
        );
        assert(
          !sql(
            `select code_hash from sys_mfa_recovery where user_id=${a.id};`,
          ).includes(recovery[0]),
        );
      },
    );
    await t.test(
      "密码和企业首因素都只能得到 MFA 挑战，恢复码并发仅一人登录",
      async () => {
        const expired = await rawLogin(a);
        sql(
          `update sys_identity_challenge set expires_at=date_sub(current_timestamp(3),interval 1 second) where token_hash='${digest(expired.challengeId)}' and user_id=${a.id};`,
        );
        await call(
          "/auth/identity/mfa/verify",
          null,
          "POST",
          { challengeId: expired.challengeId, factor: recovery[9] },
          400,
        );
        const enterprise = (await complete(await authorization())).data.login;
        assert.equal(enterprise.mfaRequired, true);
        assert.equal(enterprise.token, null);
        await call("/auth/me", enterprise.challengeId, "GET", undefined, 401);
        const primary = await rawLogin(a);
        const responses = await Promise.all(
          [0, 1].map(() =>
            fetch(base + "/auth/identity/mfa/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                challengeId: primary.challengeId,
                factor: recovery[0],
              }),
            }).then(async (r) => ({
              ok: r.status === 200,
              status: r.status,
              data: (await r.json()).data,
            })),
          ),
        );
        assert.equal(responses.filter((r) => r.ok).length, 1);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
        a.token = responses.find((r) => r.ok).data.token;
        const another = await rawLogin(a);
        await call(
          "/auth/identity/mfa/verify",
          null,
          "POST",
          { challengeId: another.challengeId, factor: recovery[0] },
          400,
        );
      },
    );
    await t.test(
      "TOTP重放、五次错误及重新创建挑战不能绕过失败限流",
      async () => {
        const enrolled = (
          await call("/auth/identity/mfa/enroll", b.token, "POST", { password })
        ).data;
        // 保存已确认的原验证码，不重新取当前码，避免运行正好跨 30 秒时把下一时段的新码误当重放。
        const acceptedCode = totp(enrolled.secret);
        const secondCodes = (
          await call("/auth/identity/mfa/confirm", b.token, "POST", {
            challengeId: enrolled.challengeId,
            factor: acceptedCode,
          })
        ).data;
        b.token = await mfaLogin(b, secondCodes[1]);
        const challenge = await rawLogin(b);
        await call(
          "/auth/identity/mfa/verify",
          null,
          "POST",
          { challengeId: challenge.challengeId, factor: acceptedCode },
          400,
        );
        for (let index = 0; index < 4; index++)
          await call(
            "/auth/identity/mfa/verify",
            null,
            "POST",
            { challengeId: challenge.challengeId, factor: "not-a-code" },
            400,
          );
        await call(
          "/auth/identity/mfa/verify",
          null,
          "POST",
          { challengeId: challenge.challengeId, factor: secondCodes[0] },
          400,
        );
        assert.equal(
          sql(
            `select failed_attempts from sys_identity_challenge where token_hash='${digest(challenge.challengeId)}';`,
          ),
          "5",
        );
        const failureKey = digest(`login-account:mfa-user:${b.id}\n${b.id}`);
        assert.equal(
          sql(
            `select attempts from sys_security_rate where rate_key='${failureKey}';`,
          ),
          "5",
        );
        // 新的正确密码/滑块不会清除 MFA 专属失败桶或重新取得二次挑战。
        await loginWithCaptcha(base, b.username, password, 400);
        assert.equal(
          sql(
            `select attempts from sys_security_rate where rate_key='${failureKey}';`,
          ),
          "5",
        );
        await call(
          "/auth/identity/users/" + b.id + "/mfa/reset",
          limited.token,
          "POST",
          { password, reason: "范围外不得恢复" },
          403,
        );
        await call(
          "/auth/identity/users/" + b.id + "/mfa/reset",
          admin,
          "POST",
          { password: "wrong", reason: "认证失败不得恢复" },
          400,
        );
        await call(
          "/auth/identity/users/" + b.id + "/mfa/reset",
          admin,
          "POST",
          { password: process.env.ADMIN_PASSWORD, reason: "遗失认证器恢复" },
        );
        await call("/auth/me", b.token, "GET", undefined, 401);
        b.token = (await rawLogin(b)).token;
        assert(b.token);
        assert.equal(
          (await call("/auth/identity/mfa", b.token)).data.enabled,
          false,
        );
      },
    );
    await t.test(
      "管理员恢复自己的 MFA 也必须证明已开通因素，恢复后密码渠道仍可登录",
      async () => {
        const prepared = (
          await call("/auth/identity/mfa/enroll", limited.token, "POST", {
            password,
          })
        ).data;
        const codes = (
          await call("/auth/identity/mfa/confirm", limited.token, "POST", {
            challengeId: prepared.challengeId,
            factor: totp(prepared.secret),
          })
        ).data;
        limited.token = await mfaLogin(limited, codes[0]);
        await call(
          `/auth/identity/users/${limited.id}/mfa/reset`,
          limited.token,
          "POST",
          { password, reason: "缺少当前因素不得恢复" },
          400,
        );
        assert.equal(
          (await call("/auth/identity/mfa", limited.token)).data.enabled,
          true,
        );
        await call(
          `/auth/identity/users/${limited.id}/mfa/reset`,
          limited.token,
          "POST",
          {
            password,
            factor: codes[1],
            reason: "本人完成双因素并重新配置认证器",
          },
        );
        await call("/auth/me", limited.token, "GET", undefined, 401);
        limited.token = (await rawLogin(limited)).token;
        assert(limited.token);
        assert.equal(
          (await call("/auth/identity/mfa", limited.token)).data.enabled,
          false,
        );
      },
    );
    await t.test("恢复码轮换撤销旧组与会话，改密必须已有MFA因素", async () => {
      await call(
        "/auth/password",
        a.token,
        "PUT",
        { oldPassword: password, newPassword: "IdentityNew_2026!" },
        400,
      );
      const oldToken = a.token;
      const next = (
        await call("/auth/identity/mfa/recovery", a.token, "POST", {
          password,
          factor: recovery[1],
        })
      ).data;
      assert.equal(next.length, 10);
      await call("/auth/me", oldToken, "GET", undefined, 401);
      const oldChallenge = await rawLogin(a);
      await call(
        "/auth/identity/mfa/verify",
        null,
        "POST",
        { challengeId: oldChallenge.challengeId, factor: recovery[2] },
        400,
      );
      recovery = next;
      a.token = await mfaLogin(a, recovery[0]);
    });
    await t.test(
      "解绑需要本人密码与MFA，禁止操作他人绑定且解绑后会话全失效",
      async () => {
        const binding = (await call("/auth/identity/bindings", a.token))
          .data[0];
        const pendingEnterprise = (await complete(await authorization())).data
          .login;
        await call(
          `/auth/identity/bindings/${binding.id}/remove`,
          b.token,
          "POST",
          { password },
          400,
        );
        await call(
          `/auth/identity/bindings/${binding.id}/remove`,
          a.token,
          "POST",
          { password },
          400,
        );
        const oldToken = a.token;
        await call(
          `/auth/identity/bindings/${binding.id}/remove`,
          a.token,
          "POST",
          { password, factor: recovery[1] },
        );
        await call("/auth/me", oldToken, "GET", undefined, 401);
        assert.equal(
          sql(
            `select count(*) from sys_change_audit where resource='用户' and resource_id=${a.id} and action='解除企业登录';`,
          ),
          "1",
        );
        await call(
          "/auth/identity/mfa/verify",
          null,
          "POST",
          { challengeId: pendingEnterprise.challengeId, factor: recovery[2] },
          400,
        );
        await complete(await authorization(), null, 400);
        a.token = await mfaLogin(a, recovery[2]);
      },
    );
    await t.test(
      "关闭MFA需双因素，旧挑战失效，本地密码渠道仍可用",
      async () => {
        const oldChallenge = await rawLogin(a);
        await call("/auth/identity/mfa/disable", a.token, "POST", {
          password,
          factor: recovery[3],
        });
        await call(
          "/auth/identity/mfa/verify",
          null,
          "POST",
          { challengeId: oldChallenge.challengeId, factor: recovery[4] },
          400,
        );
        a.token = (await rawLogin(a)).token;
        assert(a.token);
        assert.equal(
          (await call("/auth/identity/mfa", a.token)).data.enabled,
          false,
        );
      },
    );
    await t.test("停用和改密发生在首因素之后，旧挑战不能恢复账号", async () => {
      const enroll = (
        await call("/auth/identity/mfa/enroll", a.token, "POST", { password })
      ).data;
      const recovery = (
        await call("/auth/identity/mfa/confirm", a.token, "POST", {
          challengeId: enroll.challengeId,
          factor: totp(enroll.secret),
        })
      ).data;
      const disabledChallenge = await rawLogin(a);
      const setEnabled = async (enabled) => {
        const current = (
          await call(`/system/users?keyword=${a.username}`, admin)
        ).data.items.find((item) => item.id === a.id);
        assert(current);
        await call("/system/users/status", admin, "PUT", {
          rows: [{ id: a.id, version: current.version }],
          enabled,
        });
      };
      await setEnabled(false);
      await call(
        "/auth/identity/mfa/verify",
        null,
        "POST",
        { challengeId: disabledChallenge.challengeId, factor: recovery[0] },
        400,
      );
      await setEnabled(true);
      await call(
        "/auth/identity/mfa/verify",
        null,
        "POST",
        { challengeId: disabledChallenge.challengeId, factor: recovery[0] },
        400,
      );
      const primary = await rawLogin(a);
      await call(`/system/users/${a.id}/password`, admin, "PUT", {
        password: "IdentityChanged_2026!",
      });
      await call(
        "/auth/identity/mfa/verify",
        null,
        "POST",
        { challengeId: primary.challengeId, factor: recovery[0] },
        400,
      );
      await call(`/auth/identity/users/${a.id}/mfa/reset`, admin, "POST", {
        password: process.env.ADMIN_PASSWORD,
        reason: "结束隔离测试",
      });
    });
  } finally {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    for (const id of created.users) {
      assert(Number.isSafeInteger(id));
      sql(
        `delete from sys_identity_challenge where user_id=${id};delete from sys_mfa_recovery where user_id=${id};delete from sys_mfa_credential where user_id=${id};delete from sys_external_identity where user_id=${id};`,
      );
    }
    if (admin) {
      for (const id of created.users)
        await call("/system/users/" + id, admin, "DELETE");
      for (const id of created.roles)
        await call("/system/roles/" + id, admin, "DELETE");
    }
  }
});
