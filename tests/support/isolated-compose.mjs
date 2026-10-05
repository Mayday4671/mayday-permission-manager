/**
 * 真实 API 验收共用的隔离数据库入口。参数通过 JSON 数组传递，绝不拼接 shell 命令。
 * 容器与本机 Java 两种验收都只接受随机项目；覆盖文件必须由同一项目编号派生。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDockerEndpoint } from "../../scripts/runtime-environment.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const checkedEnvironments = new WeakSet();

/**
 * API 子进程同时需要宿主 Docker CLI 的发现配置及本轮 Java 的实际身份配置。
 * 隔离定位与随机口令最后写入，不能被宿主日常 API/Compose 环境覆盖；不修改 Java 启动环境。
 */
export function isolatedApiEnvironment(
  host,
  runtime,
  { project, database, base, files, compose, databasePassword, adminPassword },
  root = workspace,
) {
  assert(
    typeof databasePassword === "string" && databasePassword,
    "需要本轮隔离数据库口令",
  );
  assert(
    typeof adminPassword === "string" && adminPassword,
    "需要本轮隔离管理员口令",
  );
  const result = {
    ...host,
    ...runtime,
    VERIFY_DB_PASSWORD: databasePassword,
    VERIFY_ADMIN_PASSWORD: adminPassword,
    API_BASE: base,
    API_TEST_COMPOSE_PROJECT: project,
    API_TEST_DATABASE: database,
    API_TEST_NATIVE_FILES: files,
    MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify(compose),
  };
  isolatedComposeArguments(result, root);
  return result;
}

/**
 * 只构造本轮精确 Compose 参数，供纯逻辑测试核对；不会访问 Docker 或任何数据库。
 * 未提供覆盖数组时使用既有容器验收配置，仍必须满足随机项目和数据库服务白名单。
 */
export function isolatedComposeArguments(
  environment = process.env,
  root = workspace,
) {
  const project = environment.API_TEST_COMPOSE_PROJECT;
  assert(
    /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? ""),
    "只允许随机隔离验收项目",
  );
  assert(
    ["upgrade-db", "fresh-db"].includes(environment.API_TEST_DATABASE),
    "只允许隔离验收数据库服务",
  );
  const absoluteRoot = resolve(root);
  const expected = [
    "compose",
    "--project-directory",
    absoluteRoot,
    "-p",
    project,
    "-f",
    join(absoluteRoot, "compose.verify.yaml"),
  ];
  if (!Object.hasOwn(environment, "MAYDAY_TEST_COMPOSE_ARGS")) return expected;
  let supplied;
  try {
    supplied = JSON.parse(environment.MAYDAY_TEST_COMPOSE_ARGS);
  } catch {
    throw new Error("隔离 Compose 参数必须为 JSON 数组");
  }
  assert(
    Array.isArray(supplied) &&
      supplied.every((part) => typeof part === "string"),
    "隔离 Compose 参数必须为字符串数组",
  );
  const native = [
    ...expected,
    "-f",
    join(
      absoluteRoot,
      ".local",
      "baseline",
      project.replace(/^mayday-check-/, ""),
      "native-compose.json",
    ),
  ];
  const cluster = [
    ...expected,
    "-f",
    join(
      absoluteRoot,
      ".local",
      "cluster",
      project.replace(/^mayday-check-/, ""),
      "compose.json",
    ),
  ];
  assert(
    JSON.stringify(supplied) === JSON.stringify(expected) ||
      JSON.stringify(supplied) === JSON.stringify(native) ||
      JSON.stringify(supplied) === JSON.stringify(cluster),
    "Compose 参数不能跨项目、使用任意覆盖文件或指向日常配置",
  );
  return supplied;
}

/**
 * 每个调用环境先核验本机 Docker IPC 上下文，再用容器内已配置凭据执行 SQL。
 * 口令不出现在命令行；失败只报告固定状态，不把输入 SQL、凭据或返回正文写入日志。
 */
export function isolatedSql(
  statement,
  {
    administrator = false,
    raw = false,
    maxBuffer = 4 * 1024 * 1024,
    environment = process.env,
  } = {},
) {
  const compose = isolatedComposeArguments(environment);
  if (!checkedEnvironments.has(environment)) {
    assertLocalDockerEndpoint(environment);
    checkedEnvironments.add(environment);
  }
  const credential = administrator
    ? 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root'
    : 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER"';
  const result = spawnSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      environment.API_TEST_DATABASE,
      "sh",
      "-c",
      credential +
        ' --database="$MYSQL_DATABASE" --default-character-set=utf8mb4 --batch --skip-column-names' +
        (raw ? " --raw" : ""),
    ],
    {
      cwd: workspace,
      env: environment,
      input: statement,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer,
      timeout: 180000,
    },
  );
  assert(
    !result.error && result.status === 0,
    "隔离验收 SQL 执行失败，子进程状态：" + result.status,
  );
  return result.stdout;
}
