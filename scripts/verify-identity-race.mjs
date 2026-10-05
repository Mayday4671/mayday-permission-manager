/**
 * 企业身份的真实并发撤销验收。使用调用方已构建的 JAR，独占随机 MySQL、端口和文件目录，
 * 不运行 Maven、不连接日常库、不增加生产测试接口。仅本轮临时数据库安装触发器屏障：
 * 真实 HTTP 解绑/开通 MFA 在持账号锁后暂停，认证请求确实等锁后才放行，验证 RR 当前读。
 * 输出只包含状态、计数和产物摘要；密码、OTP、恢复码、会话、cookie 和企业授权码不进入报告。
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

/** 动态端口只绑定 loopback；现有身份验收的 18390 不参与本轮使用。 */
async function freePort() {
  const server = tcpServer();
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port === 18390 ? freePort() : port;
}

async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(message);
}

/** 本轮认证器协议仅在内存计算；算法与已有真实登录辅助保持一致，不伪造后台登录状态。 */
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0,
    bits = 0;
  const bytes = [];
  for (const character of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

/**
 * 导入只提供入口，不启动环境。native 验收传入本轮冻结 JAR 后，只有所有真实边界通过且
 * 自有进程/容器清理成功才返回 passed。expectVulnerable 仅用于旧版本复现，不是发布通过。
 */
export async function verifyIdentityRace({
  jar: sourceJar,
  java,
  expectVulnerable = false,
  root = resolve(process.cwd()),
}) {
  process.umask(0o077);
  root = resolve(root);
  assert(
    existsSync(join(root, "backend", "pom.xml")),
    "身份并发验收必须从项目工作区运行",
  );
  const { javaRuntimeEnvironment, assertLocalDockerEndpoint } = await import(
    pathToFileURL(join(root, "scripts", "runtime-environment.mjs"))
  );
  const { loginWithCaptcha } = await import(
    pathToFileURL(join(root, "tests", "support", "captcha.mjs"))
  );
  assertLocalDockerEndpoint();
  const runId =
    new Date().toISOString().replace(/\D/g, "") +
    "-" +
    randomBytes(3).toString("hex");
  const container = "mayday-identity-race-" + runId;
  const database = "mayday_identity_race";
  const output = join(root, ".local", "identity-race", runId);
  mkdirSync(output, { recursive: true });
  const artifact = join(output, "runtime.jar");
  copyFileSync(resolve(sourceJar), artifact);
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const report = {
    runId,
    status: "running",
    artifactSha256: sha256(readFileSync(artifact)),
    startedAt: new Date().toISOString(),
    checks: [],
    cleanupSucceeded: false,
    reportPath: join(output, "report.json"),
  };
  const password = "Race_" + randomBytes(24).toString("base64url") + "9!";
  const dbPassword = randomBytes(24).toString("hex");
  const clientSecret = randomBytes(24).toString("hex");
  const clientId = "mayday-race";
  const hostEnvironment = {
    ...process.env,
    MYSQL_ROOT_PASSWORD: dbPassword,
    MYSQL_PASSWORD: dbPassword,
  };
  const children = new Set();
  let created = false,
    provider,
    javaChild,
    stage = "准备自有隔离环境";
  const command = (args, input, allowFailure = false) => {
    const result = spawnSync("docker", args, {
      cwd: root,
      env: hostEnvironment,
      input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!allowFailure && (result.error || result.status !== 0))
      throw new Error("自有隔离数据库命令失败");
    return result;
  };
  const mysqlArguments = [
    "exec",
    "-i",
    container,
    "sh",
    "-c",
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --database=mayday_identity_race --default-character-set=utf8mb4 --batch --raw --skip-column-names --unbuffered',
  ];
  const sql = (statement) => {
    assert(
      created && /^mayday-identity-race-\d+-[a-f0-9]{6}$/.test(container),
      "SQL 必须限定本轮自有数据库",
    );
    return command(mysqlArguments, statement).stdout.trim();
  };
  const api = async (base, path, token, body, cookie, method = "POST") => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    return { status: response.status, envelope: await response.json() };
  };
  const success = (response) => {
    assert.equal(response.status, 200, "真实身份接口未成功");
    assert.equal(response.envelope.success, true, "真实身份响应未成功");
    return response.envelope.data;
  };
  /** 测试屏障只暂停真实安全操作，不直接改身份数据；超时 SIGNAL 让变更事务失败回滚。 */
  const installBarrier = (table, operation, userId, name) => {
    assert(Number.isSafeInteger(userId) && userId > 0);
    assert(["sys_external_identity", "sys_mfa_credential"].includes(table));
    assert(["DELETE", "INSERT"].includes(operation));
    assert(/^identity_race_[a-f0-9]{16}$/.test(name));
    const record = operation === "DELETE" ? "OLD" : "NEW";
    sql(`DROP TRIGGER IF EXISTS identity_race_barrier;
DELIMITER //
CREATE TRIGGER identity_race_barrier BEFORE ${operation} ON ${table}
FOR EACH ROW BEGIN
  IF ${record}.user_id = ${userId} THEN
    SET @identity_race_gate = GET_LOCK('${name}', 20);
    IF @identity_race_gate <> 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'identity race barrier timed out';
    END IF;
    DO RELEASE_LOCK('${name}');
  END IF;
END //
DELIMITER ;
`);
  };
  /** 独立控制连接持有 advisory gate；安全操作和认证均由应用连接池实际执行。 */
  const holdBarrier = async (name) => {
    const control = spawn("docker", mysqlArguments, {
      cwd: root,
      env: hostEnvironment,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(control);
    control.once("exit", () => children.delete(control));
    let text = "";
    let controlFailed = false;
    control.once("error", () => {
      controlFailed = true;
      children.delete(control);
    });
    control.stdout.setEncoding("utf8");
    control.stdout.on("data", (part) => {
      text += part;
    });
    control.stderr.on("data", () => {});
    control.stdin.write(
      `SELECT GET_LOCK('${name}', 0); SELECT 'BARRIER_READY';\n`,
    );
    await until(() => {
      assert(!controlFailed, "控制连接无法启动");
      return text.includes("BARRIER_READY");
    }, "控制连接未持有屏障");
    assert(
      text.startsWith("1\n") || text.startsWith("1\r\n"),
      "控制连接未获取专属屏障",
    );
    return async () => {
      if (control.exitCode !== null) return;
      control.stdin.end(`DO RELEASE_LOCK('${name}');\n`);
      await until(() => control.exitCode !== null, "屏障控制连接未结束");
    };
  };
  /** 读取服务端锁等待证据，而非依赖固定 sleep 猜测竞争是否发生。 */
  const waitMutation = async (name) => {
    await until(
      () =>
        Number(
          sql(`SELECT COUNT(*) FROM performance_schema.metadata_locks
WHERE OBJECT_TYPE='USER LEVEL LOCK' AND OBJECT_NAME='${name}' AND LOCK_STATUS='PENDING';`),
        ) > 0,
      "真实安全操作未在账号锁内到达屏障",
    );
  };
  const waitAuthentication = async (userId) => {
    await until(
      () =>
        Number(
          sql(`SELECT COUNT(*) FROM performance_schema.data_lock_waits AS w
JOIN performance_schema.data_locks AS r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
WHERE r.OBJECT_SCHEMA='${database}' AND r.OBJECT_NAME='sys_user'
AND r.INDEX_NAME='PRIMARY' AND r.LOCK_DATA='${userId}';`),
        ) > 0,
      "真实认证请求未等待目标账号锁",
    );
  };
  /** 三个场景逐项保留证据；旧版本复现模式必须三项都观察到漏洞，不能记为发布通过。 */
  const record = (name, response, protectedBoundary, mutationStatus) => {
    report.checks.push({
      name,
      status: protectedBoundary ? "passed" : "failed",
      responseStatus: response.status,
      mutationStatus,
      accountLockWaitProved: true,
      noSessionIssued:
        !response.envelope.data?.token && !response.envelope.data?.login?.token,
      mfaRequired: response.envelope.data?.login?.mfaRequired ?? null,
    });
  };
  try {
    command(["image", "inspect", "mysql:8.4"]);
    command([
      "run",
      "-d",
      "--pull=never",
      "--name",
      container,
      "--label",
      "com.mayday.identity-race=" + runId,
      "-p",
      "127.0.0.1::3306",
      "-e",
      "MYSQL_ROOT_PASSWORD",
      "-e",
      "MYSQL_PASSWORD",
      "-e",
      "MYSQL_DATABASE=" + database,
      "-e",
      "MYSQL_USER=mayday_race",
      "mysql:8.4",
    ]);
    created = true;
    await until(
      () =>
        command(
          [
            "exec",
            container,
            "sh",
            "-c",
            'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP --host=127.0.0.1 --user=mayday_race --database=mayday_identity_race --execute="SELECT 1" --silent',
          ],
          undefined,
          true,
        ).status === 0,
      "自有数据库未就绪",
      120000,
    );
    assert.equal(
      sql("SELECT @@transaction_isolation;"),
      "REPEATABLE-READ",
      "必须验证 MySQL 默认 RR 隔离级别",
    );
    const dbPort = command(["port", container, "3306/tcp"])
      .stdout.trim()
      .split(":")
      .at(-1);
    assert(/^\d+$/.test(dbPort), "自有数据库端口无效");
    const providerPort = await freePort();
    const apiPort = await freePort();
    const issuer = `http://127.0.0.1:${providerPort}`;
    const base = `http://127.0.0.1:${apiPort}/api`;
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const key = {
      ...publicKey.export({ format: "jwk" }),
      kid: "identity-race",
      use: "sig",
      alg: "RS256",
    };
    const codes = new Map();
    let subject;
    provider = httpServer(async (request, response) => {
      try {
        const url = new URL(request.url, issuer);
        if (url.pathname === "/jwks") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ keys: [key] }));
          return;
        }
        if (url.pathname === "/authorize") {
          assert.equal(url.searchParams.get("client_id"), clientId);
          assert.equal(url.searchParams.get("code_challenge_method"), "S256");
          const code = randomUUID();
          codes.set(code, {
            subject,
            nonce: url.searchParams.get("nonce"),
            challenge: url.searchParams.get("code_challenge"),
            redirect: url.searchParams.get("redirect_uri"),
          });
          const target = new URL(url.searchParams.get("redirect_uri"));
          target.searchParams.set("code", code);
          target.searchParams.set("state", url.searchParams.get("state"));
          response.writeHead(302, { Location: target.href });
          response.end();
          return;
        }
        if (url.pathname === "/token") {
          let text = "";
          for await (const part of request) text += part;
          const body = new URLSearchParams(text);
          const pending = codes.get(body.get("code"));
          codes.delete(body.get("code"));
          assert(pending);
          assert.equal(
            request.headers.authorization,
            "Basic " +
              Buffer.from(clientId + ":" + clientSecret).toString("base64"),
          );
          assert.equal(
            sha256(body.get("code_verifier") ?? ""),
            Buffer.from(pending.challenge, "base64url").toString("hex"),
          );
          assert.equal(body.get("redirect_uri"), pending.redirect);
          const now = Math.floor(Date.now() / 1000);
          const input =
            Buffer.from(
              JSON.stringify({ alg: "RS256", kid: key.kid }),
            ).toString("base64url") +
            "." +
            Buffer.from(
              JSON.stringify({
                iss: issuer,
                sub: pending.subject,
                aud: clientId,
                nonce: pending.nonce,
                iat: now,
                exp: now + 300,
              }),
            ).toString("base64url");
          const token =
            input +
            "." +
            sign("RSA-SHA256", Buffer.from(input), privateKey).toString(
              "base64url",
            );
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ id_token: token }));
          return;
        }
        response.writeHead(404);
        response.end();
      } catch {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end('{"error":"invalid_grant"}');
      }
    });
    await new Promise((ok, fail) => {
      provider.once("error", fail);
      provider.listen(providerPort, "127.0.0.1", ok);
    });
    const runtime = javaRuntimeEnvironment(process.env, {
      DB_URL: `jdbc:mysql://127.0.0.1:${dbPort}/${database}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`,
      DB_USERNAME: "mayday_race",
      DB_PASSWORD: dbPassword,
      ADMIN_PASSWORD: password,
      SEED_DEMO_DATA: "false",
      MODULE_UDP_ENABLED: "false",
      MODULE_CRAWLER_ENABLED: "false",
      MODULE_SCHEDULER_ENABLED: "false",
      MAYDAY_BULK_WORKERSENABLED: "false",
      MAYDAY_STORAGE_MODE: "LOCAL",
      MAYDAY_STORAGE_LOCAL_ROOT: join(output, "files"),
      MAYDAY_MFA_ENABLED: "true",
      MAYDAY_IDENTITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      MAYDAY_IDENTITY_PROVIDERS_0_ID: "race-identity",
      MAYDAY_IDENTITY_PROVIDERS_0_NAME: "隔离竞争身份",
      MAYDAY_IDENTITY_PROVIDERS_0_ISSUER: issuer,
      MAYDAY_IDENTITY_PROVIDERS_0_CLIENTID: clientId,
      MAYDAY_IDENTITY_PROVIDERS_0_CLIENTSECRET: clientSecret,
      MAYDAY_IDENTITY_PROVIDERS_0_AUTHORIZATIONURI: issuer + "/authorize",
      MAYDAY_IDENTITY_PROVIDERS_0_TOKENURI: issuer + "/token",
      MAYDAY_IDENTITY_PROVIDERS_0_JWKSURI: issuer + "/jwks",
      MAYDAY_IDENTITY_PROVIDERS_0_REDIRECTURI: `http://127.0.0.1:${apiPort}/auth/oidc/callback`,
      MAYDAY_IDENTITY_PROVIDERS_0_CLIENTAUTHENTICATION: "client_secret_basic",
      MAYDAY_IDENTITY_PROVIDERS_0_ENABLED: "true",
    });
    const javaBinary =
      java ??
      (process.env.JAVA_HOME
        ? join(
            process.env.JAVA_HOME,
            "bin",
            process.platform === "win32" ? "java.exe" : "java",
          )
        : "java");
    const log = openSync(join(output, "backend.log"), "a");
    let javaFailed = false;
    try {
      javaChild = spawn(
        javaBinary,
        [
          "-Xms64m",
          "-Xmx384m",
          "-jar",
          artifact,
          "--spring.config.location=classpath:/application.yml",
          `--server.port=${apiPort}`,
          `--mayday.bulk.spool-directory=${join(output, "bulk")}`,
        ],
        {
          cwd: root,
          env: runtime,
          windowsHide: true,
          stdio: ["ignore", log, log],
        },
      );
      children.add(javaChild);
      javaChild.once("error", () => {
        javaFailed = true;
        children.delete(javaChild);
      });
      javaChild.once("exit", () => children.delete(javaChild));
    } finally {
      closeSync(log);
    }
    await until(
      async () => {
        assert(
          !javaFailed && javaChild.exitCode === null,
          "自有 Java 进程提前退出或无法启动",
        );
        try {
          return (
            await fetch(
              `http://127.0.0.1:${apiPort}/actuator/health/readiness`,
              { signal: AbortSignal.timeout(1000) },
            )
          ).ok;
        } catch {
          return false;
        }
      },
      "自有 Java 进程未就绪",
      120000,
    );
    const admin = (await loginWithCaptcha(base, "admin", password)).token;
    assert(admin, "隔离管理员未正常登录");
    const pendingAuthorization = async (user, binding = false) => {
      subject = user.subject;
      const response = await fetch(
        base +
          (binding ? "/auth/identity/oidc/bind" : "/auth/identity/oidc/start"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(binding ? { Authorization: "Bearer " + user.token } : {}),
          },
          body: JSON.stringify({
            providerId: "race-identity",
            ...(binding ? { password } : {}),
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      assert.equal(response.status, 200, "企业授权启动未成功");
      const { data } = await response.json();
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert(
        cookie && response.headers.get("set-cookie").includes("HttpOnly"),
        "缺少真实浏览器关联 cookie",
      );
      const visited = await fetch(data.authorizationUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(visited.status, 302, "隔离提供方未返回授权 code");
      const callback = new URL(visited.headers.get("location"));
      return {
        cookie,
        state: callback.searchParams.get("state"),
        code: callback.searchParams.get("code"),
      };
    };
    const complete = (pending, token) =>
      api(
        base,
        "/auth/identity/oidc/complete",
        token,
        { state: pending.state, code: pending.code },
        pending.cookie,
      );
    const makeUser = async (suffix) => {
      const username = "race_" + randomBytes(6).toString("hex") + "_" + suffix;
      const user = success(
        await api(base, "/system/users", admin, {
          username,
          nickname: "隔离并发验收",
          password,
          enabled: true,
          roleIds: [],
        }),
      );
      const token = (await loginWithCaptcha(base, username, password)).token;
      assert(token, "隔离账号未通过真实登录");
      const result = {
        ...user,
        username,
        token,
        subject: "subject_" + randomUUID(),
      };
      const bound = success(
        await complete(await pendingAuthorization(result, true), token),
      );
      assert.equal(bound.bound, true, "隔离账号未完成企业绑定");
      result.binding = success(
        await api(
          base,
          "/auth/identity/bindings",
          token,
          undefined,
          undefined,
          "GET",
        ),
      )[0].id;
      return result;
    };
    const runRace = async ({
      table,
      operation,
      user,
      mutation,
      authentication,
    }) => {
      const gate = "identity_race_" + randomBytes(8).toString("hex");
      installBarrier(table, operation, user.id, gate);
      const release = await holdBarrier(gate);
      let mutationRequest, authenticationRequest;
      try {
        mutationRequest = mutation();
        // 捕获等待期间的失败，避免未处理拒绝；统一在释放屏障后读取真实响应。
        mutationRequest.catch(() => {});
        await waitMutation(gate);
        authenticationRequest = authentication();
        authenticationRequest.catch(() => {});
        await waitAuthentication(user.id);
        await release();
        const changed = await mutationRequest;
        success(changed);
        return { changed, authenticated: await authenticationRequest };
      } finally {
        await release();
        await Promise.allSettled(
          [mutationRequest, authenticationRequest].filter(Boolean),
        );
        sql("DROP TRIGGER IF EXISTS identity_race_barrier;");
      }
    };
    stage = "OIDC 解绑与等锁回调";
    const first = await makeUser("unbind");
    const firstPending = await pendingAuthorization(first);
    const firstRace = await runRace({
      table: "sys_external_identity",
      operation: "DELETE",
      user: first,
      mutation: () =>
        api(
          base,
          `/auth/identity/bindings/${first.binding}/remove`,
          first.token,
          { password },
        ),
      authentication: () => complete(firstPending),
    });
    record(
      "解绑提交后等锁中的 OIDC 回调不得签发会话",
      firstRace.authenticated,
      firstRace.authenticated.status === 400 &&
        firstRace.authenticated.envelope.success === false &&
        !firstRace.authenticated.envelope.data,
      firstRace.changed.status,
    );

    stage = "企业 MFA 挑战与解绑";
    const second = await makeUser("mfa_unbind");
    const enrolled = success(
      await api(base, "/auth/identity/mfa/enroll", second.token, { password }),
    );
    const recovery = success(
      await api(base, "/auth/identity/mfa/confirm", second.token, {
        challengeId: enrolled.challengeId,
        factor: totp(enrolled.secret),
      }),
    );
    const primary = await loginWithCaptcha(base, second.username, password);
    assert.equal(primary.mfaRequired, true);
    second.token = success(
      await api(base, "/auth/identity/mfa/verify", null, {
        challengeId: primary.challengeId,
        factor: recovery[0],
      }),
    ).token;
    const enterprise = success(
      await complete(await pendingAuthorization(second)),
    ).login;
    assert.equal(enterprise.mfaRequired, true);
    const secondRace = await runRace({
      table: "sys_external_identity",
      operation: "DELETE",
      user: second,
      mutation: () =>
        api(
          base,
          `/auth/identity/bindings/${second.binding}/remove`,
          second.token,
          { password, factor: recovery[1] },
        ),
      authentication: () =>
        api(base, "/auth/identity/mfa/verify", null, {
          challengeId: enterprise.challengeId,
          factor: recovery[2],
        }),
    });
    record(
      "解绑提交后旧企业 MFA 挑战不得签发会话",
      secondRace.authenticated,
      secondRace.authenticated.status === 400 &&
        secondRace.authenticated.envelope.success === false &&
        !secondRace.authenticated.envelope.data,
      secondRace.changed.status,
    );

    stage = "MFA 刚开通与等锁 OIDC 回调";
    const third = await makeUser("mfa_enable");
    const thirdEnrollment = success(
      await api(base, "/auth/identity/mfa/enroll", third.token, { password }),
    );
    const thirdPending = await pendingAuthorization(third);
    const thirdRace = await runRace({
      table: "sys_mfa_credential",
      operation: "INSERT",
      user: third,
      mutation: () =>
        api(base, "/auth/identity/mfa/confirm", third.token, {
          challengeId: thirdEnrollment.challengeId,
          factor: totp(thirdEnrollment.secret),
        }),
      authentication: () => complete(thirdPending),
    });
    const login = thirdRace.authenticated.envelope.data?.login;
    record(
      "开通 MFA 提交后等锁中的 OIDC 回调必须进入二次验证",
      thirdRace.authenticated,
      thirdRace.authenticated.status === 200 &&
        thirdRace.authenticated.envelope.success === true &&
        login?.mfaRequired === true &&
        !login.token &&
        typeof login.challengeId === "string",
      thirdRace.changed.status,
    );
    report.status = expectVulnerable
      ? report.checks.length === 3 &&
        report.checks.every(
          (check) => check.status === "failed" && !check.noSessionIssued,
        )
        ? "reproduced"
        : "failed"
      : report.checks.length === 3 &&
          report.checks.every((check) => check.status === "passed")
        ? "passed"
        : "failed";
  } catch {
    report.status = "failed";
    report.failureStage = stage;
  } finally {
    let clean = true;
    for (const child of children) {
      try {
        child.kill("SIGKILL");
        await until(
          () => child.exitCode !== null || child.signalCode !== null,
          "自有验收子进程未结束",
          10000,
        );
      } catch {
        clean = false;
      }
    }
    if (provider) await new Promise((ok) => provider.close(ok));
    if (created) {
      try {
        const owned = command([
          "inspect",
          "--format",
          '{{ index .Config.Labels "com.mayday.identity-race" }}',
          container,
        ]).stdout.trim();
        assert.equal(owned, runId, "只允许清理本轮自有隔离容器");
        command(["rm", "-f", "-v", container]);
      } catch {
        clean = false;
      }
    }
    report.cleanupSucceeded = clean;
    if (!clean) report.status = "failed";
    report.finishedAt = new Date().toISOString();
    writeFileSync(report.reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

/** CLI 与 native 共享同一个实现，导入时不创建进程或数据库。 */
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await verifyIdentityRace({
    jar: resolve(process.argv[2] ?? ".local/full-integrated-qa.jar"),
    expectVulnerable: process.argv.includes("--expect-vulnerable"),
  });
  console.log(
    "身份并发验收：" + result.status + "；报告：" + result.reportPath,
  );
  if (result.status === "failed") process.exitCode = 1;
}
