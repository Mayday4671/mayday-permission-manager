/**
 * Java 启动只继承运行系统所需环境，再注入调用方明确核对的应用配置。
 * 隔离验收不能继承宿主 Spring 属性、JVM 注入参数、云凭据或其他项目的数据库/文件配置。
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const systemKeys = new Set([
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "ALLUSERSPROFILE",
  "PUBLIC",
  "JAVA_HOME",
  "LANG",
  "TZ",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
]);

/** 显式配置也不能打开可覆盖数据库地址的高优先级 Spring/JVM 配置入口。 */
export function javaRuntimeEnvironment(host, configuration) {
  const result = Object.fromEntries(
    Object.entries(host).filter(
      ([key, value]) =>
        value !== undefined &&
        (systemKeys.has(key.toUpperCase()) || /^LC_[A-Z_]+$/i.test(key)),
    ),
  );
  for (const [key, value] of Object.entries(configuration)) {
    const normalized = key.toUpperCase();
    if (
      !/^[A-Z][A-Z0-9_]*$/.test(normalized) ||
      normalized.startsWith("SPRING_") ||
      [
        "JAVA_TOOL_OPTIONS",
        "JDK_JAVA_OPTIONS",
        "JAVA_OPTS",
        "_JAVA_OPTIONS",
      ].includes(normalized)
    )
      throw new Error("Java 启动配置入口不被允许：" + key);
    if (value !== undefined && value !== null)
      result[normalized] = String(value);
  }
  return result;
}

/** 本机 Java 和 Docker 数据库必须属于同一宿主；远程 TCP/SSH 与远程命名管道不接受。 */
export function isLocalDockerEndpoint(endpoint, platform = process.platform) {
  return platform === "win32"
    ? /^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint)
    : /^unix:\/\/\/[^\x00\r\n?#]+$/.test(endpoint);
}

/** docker context 之外还检查 DOCKER_HOST，避免隐式环境覆盖选择的本地上下文。 */
export function assertLocalDockerEndpoint(environment = process.env) {
  if (environment.DOCKER_HOST)
    assert(
      isLocalDockerEndpoint(environment.DOCKER_HOST),
      "原生验收/升级只允许本机 Docker IPC 端点",
    );
  const current = spawnSync("docker", ["context", "show"], {
    env: environment,
    encoding: "utf8",
    windowsHide: true,
  });
  assert(
    !current.error && current.status === 0 && current.stdout.trim(),
    "无法读取本机 Docker 上下文",
  );
  const inspected = spawnSync(
    "docker",
    ["context", "inspect", current.stdout.trim()],
    { env: environment, encoding: "utf8", windowsHide: true },
  );
  assert(
    !inspected.error && inspected.status === 0,
    "无法核验本机 Docker 端点",
  );
  const endpoint = JSON.parse(inspected.stdout)[0]?.Endpoints?.docker?.Host;
  assert(
    typeof endpoint === "string" && isLocalDockerEndpoint(endpoint),
    "原生验收/升级不能连接远程 Docker",
  );
}
