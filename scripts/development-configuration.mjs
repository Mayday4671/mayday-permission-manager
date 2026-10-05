/**
 * Windows 开发启动配置的纯函数边界：不执行 .env、不读取数据库，也不打印凭据。
 * Docker 与 Java 使用同一份显式配置；宿主环境不能覆盖项目数据库、模块或身份设置。
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { javaRuntimeEnvironment } from "./runtime-environment.mjs";

/** 解析简单 KEY=VALUE 格式，支持数字索引和整段引号；#、$ 与反引号在值内保持字面量。 */
export function parseDevelopmentEnvironment(source) {
  const settings = {};
  for (const [index, original] of source
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    assert(match, `第 ${index + 1} 行不是合法的 KEY=VALUE 配置`);
    const [, key, input] = match;
    assert(!Object.hasOwn(settings, key), `配置键重复：${key}`);
    let value = input.trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      assert(
        value.length >= 2 && value.endsWith(value[0]),
        `配置引号未闭合：${key}`,
      );
      value = value.slice(1, -1);
    }
    settings[key] = value;
  }
  // 不允许从 .env 重新引入 Spring/JVM 的高优先级覆盖入口，先核对全部键再筛选业务项。
  javaRuntimeEnvironment({}, settings);
  for (const key of Object.keys(settings))
    assert(
      !key.startsWith("COMPOSE_"),
      "Compose 路径和项目身份由当前仓库固定，不能在 .env 覆盖",
    );
  return settings;
}

/** 构建固定回环地址的原生应用环境；数据库必须对应本项目 Compose 的映射端口和库名。 */
export function developmentConfiguration(root, settings, hostEnvironment) {
  const port = (key, fallback) => {
    const value = settings[key] ?? String(fallback);
    assert(
      /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535,
      `${key} 必须是 1–65535 的整数`,
    );
    return Number(value);
  };
  const apiPort = port("API_PORT", 18080);
  const webPort = port("WEB_PORT", 15173);
  const databasePort = port("DB_PORT", 13306);
  assert(
    new Set([apiPort, webPort, databasePort]).size === 3,
    "前端、后端和 MySQL 端口不能重复",
  );
  const database = settings.MYSQL_DATABASE ?? "mayday";
  const username = settings.MYSQL_USER ?? "mayday";
  assert(
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(database),
    "MYSQL_DATABASE 库名不合法",
  );
  assert(
    /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(username),
    "MYSQL_USER 用户名不合法",
  );
  for (const key of ["MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD", "ADMIN_PASSWORD"])
    assert(
      typeof settings[key] === "string" && settings[key].length > 0,
      `${key} 不能为空`,
    );
  const databasePrefix = `jdbc:mysql://127.0.0.1:${databasePort}/${database}`;
  const databaseUrl =
    settings.DB_URL ??
    `${databasePrefix}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai`;
  assert(
    databaseUrl === databasePrefix ||
      databaseUrl.startsWith(databasePrefix + "?"),
    "DB_URL 只能指向当前项目的本机 MySQL 库和端口",
  );
  assert(!/[\r\n\x00]/.test(databaseUrl), "DB_URL 包含非法控制字符");
  for (const [key, expected] of [
    ["DB_USERNAME", username],
    ["DB_PASSWORD", settings.MYSQL_PASSWORD],
    ["SERVER_PORT", String(apiPort)],
    ["SERVER_ADDRESS", "127.0.0.1"],
  ])
    assert(
      settings[key] === undefined || settings[key] === expected,
      `${key} 与本机启动配置不一致`,
    );
  const applicationSettings = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) =>
        /^(?:MAYDAY_|MODULE_)/.test(key) ||
        [
          "DB_MIGRATIONS_ENABLED",
          "ADMIN_PASSWORD",
          "SEED_DEMO_DATA",
          "API_DOCS_ENABLED",
        ].includes(key),
    ),
  );
  const javaEnvironment = javaRuntimeEnvironment(hostEnvironment, {
    ...applicationSettings,
    DB_URL: databaseUrl,
    DB_USERNAME: username,
    DB_PASSWORD: settings.MYSQL_PASSWORD,
    SERVER_ADDRESS: "127.0.0.1",
    SERVER_PORT: String(apiPort),
    // 与旧原生启动器的工作目录及默认 ./data/files 相同，不能擅自迁移已有上传正文。
    MAYDAY_STORAGE_LOCAL_ROOT: resolve(
      root,
      settings.MAYDAY_STORAGE_LOCAL_ROOT || "data/files",
    ),
  });
  // Docker CLI 保留本机 IPC/认证所需环境，但项目的变量只能来自 .env 或仓库默认值。
  const dockerEnvironment = Object.fromEntries(
    Object.entries(hostEnvironment).filter(
      ([key]) =>
        !/^(?:COMPOSE_|MYSQL_|DB_|API_|WEB_|UDP_|MAYDAY_|MODULE_|ADMIN_|SEED_)/i.test(
          key,
        ),
    ),
  );
  Object.assign(dockerEnvironment, settings);
  const frontendEnvironment = javaRuntimeEnvironment(hostEnvironment, {
    VITE_API_TARGET: `http://127.0.0.1:${apiPort}`,
  });
  return {
    apiPort,
    webPort,
    databasePort,
    javaEnvironment,
    dockerEnvironment,
    frontendEnvironment,
  };
}

/** 使用完整参数而不是目录子串核对进程；新记录还核对创建时间，避免 PID 被其他程序复用。 */
export function assertDevelopmentProcess(record, role, information, root) {
  if (!information) return;
  const expectedName = role === "backend" ? "java.exe" : "node.exe";
  const normalize = (value) =>
    String(value).replaceAll("\\", "/").toLowerCase();
  const tokens =
    (information.CommandLine ?? "")
      .match(/"[^"]*"|[^\s"]+/g)
      ?.map((value) => value.replace(/^"|"$/g, "")) ?? [];
  const expectedPath =
    role === "backend"
      ? resolve(root, ".local", "mayday-runtime.jar")
      : resolve(root, "frontend", "node_modules", "vite", "bin", "vite.js");
  assert(
    information.Name?.toLowerCase() === expectedName,
    `${role} 记录不属于本项目进程`,
  );
  const matched =
    role === "backend"
      ? tokens.some(
          (token, index) =>
            token === "-jar" &&
            normalize(tokens[index + 1]) === normalize(expectedPath),
        )
      : tokens.some((token) => normalize(token) === normalize(expectedPath));
  assert(matched, `${role} 运行路径与当前项目不一致`);
  const identity = record.identities?.[role];
  if (identity)
    assert(
      identity.pid === information.ProcessId &&
        identity.createdAt === information.CreatedAt &&
        normalize(identity.executable) ===
          normalize(information.ExecutablePath),
      `${role} 进程身份已变化，拒绝停止`,
    );
}
