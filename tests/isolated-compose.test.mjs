/** 隔离验收的纯参数回归；不启动 Docker、数据库、Java，也不执行测试 SQL。 */
import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  isolatedComposeArguments,
  isolatedApiEnvironment,
  assertIsolatedDatabaseBinding,
} from "./support/isolated-compose.mjs";

const root = resolve(".local", "compose argument fixture");
const project = "mayday-check-20261005110000-a1b2c3";
const env = {
  API_TEST_COMPOSE_PROJECT: project,
  API_TEST_DATABASE: "fresh-db",
};
const expected = [
  "compose",
  "--project-directory",
  root,
  "-p",
  project,
  "-f",
  join(root, "compose.verify.yaml"),
];
const native = [
  ...expected,
  "-f",
  join(
    root,
    ".local",
    "baseline",
    "20261005110000-a1b2c3",
    "native-compose.json",
  ),
];

test("API 保留 Docker 插件发现环境，随机口令/项目覆盖宿主，Java 环境保持原样", () => {
  const host = Object.freeze({
    ProgramFiles: "C:/fake-program-files",
    "ProgramFiles(x86)": "C:/fake-program-files-x86",
    ProgramW6432: "C:/fake-program-files",
    DOCKER_CONFIG: "C:/fake-cli-config",
    DOCKER_CLI_PLUGIN_EXTRA_DIRS: "C:/fake-compose-plugin",
    VERIFY_DB_PASSWORD: "daily-database-password",
    API_TEST_COMPOSE_PROJECT: "mayday",
    MAYDAY_TEST_COMPOSE_ARGS: "invalid-host-value",
  });
  const runtime = Object.freeze({
    SERVER_PORT: "18123",
    DB_PASSWORD: "isolated-database-password",
    ADMIN_PASSWORD: "isolated-admin-password",
  });
  const actual = isolatedApiEnvironment(
    host,
    runtime,
    {
      project,
      database: "fresh-db",
      base: "http://127.0.0.1:18123/api",
      files: join(root, "native-files", "fresh"),
      compose: native,
      databasePassword: "isolated-database-password",
      adminPassword: "isolated-admin-password",
    },
    root,
  );
  for (const key of [
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "DOCKER_CONFIG",
    "DOCKER_CLI_PLUGIN_EXTRA_DIRS",
  ])
    assert.equal(actual[key], host[key]);
  assert.equal(actual.VERIFY_DB_PASSWORD, runtime.DB_PASSWORD);
  assert.equal(actual.VERIFY_ADMIN_PASSWORD, runtime.ADMIN_PASSWORD);
  assert.equal(actual.API_TEST_COMPOSE_PROJECT, project);
  assert.deepEqual(JSON.parse(actual.MAYDAY_TEST_COMPOSE_ARGS), native);
  assert(!Object.hasOwn(runtime, "ProgramFiles"));
  assert.equal(host.API_TEST_COMPOSE_PROJECT, "mayday");
});

test("容器验收只构造随机项目的固定配置，忽略宿主默认 Compose 文件", () => {
  assert.deepEqual(
    isolatedComposeArguments(
      { ...env, COMPOSE_FILE: "compose.yaml", COMPOSE_PROJECT_NAME: "mayday" },
      root,
    ),
    expected,
  );
});

test("原生验收 JSON 数组完整保留本轮覆盖文件和含空格路径", () => {
  assert.deepEqual(
    isolatedComposeArguments(
      { ...env, MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify(native) },
      root,
    ),
    native,
  );
  assert.deepEqual(
    isolatedComposeArguments(
      { ...env, MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify(expected) },
      root,
    ),
    expected,
  );
});

test("集群验收只接受同一随机项目派生的覆盖文件", () => {
  const cluster = [
    ...expected,
    "-f",
    join(root, ".local", "cluster", "20261005110000-a1b2c3", "compose.json"),
  ];
  assert.deepEqual(
    isolatedComposeArguments(
      { ...env, MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify(cluster) },
      root,
    ),
    cluster,
  );
  for (const path of [
    join(root, ".local", "cluster", "different-run", "compose.json"),
    join(root, ".local", "cluster", "20261005110000-a1b2c3", "another.json"),
  ]) {
    const altered = [...cluster];
    altered[8] = path;
    assert.throws(() =>
      isolatedComposeArguments(
        { ...env, MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify(altered) },
        root,
      ),
    );
  }
});

test("日常项目、其他服务和可执行字符串不能作为隔离 SQL 目标", () => {
  for (const project of [
    undefined,
    "",
    "mayday",
    "mayday-check-123-a1b2c3; echo unsafe",
    "mayday-check-123-ABCDEF",
  ])
    assert.throws(() =>
      isolatedComposeArguments(
        { ...env, API_TEST_COMPOSE_PROJECT: project },
        root,
      ),
    );
  for (const database of [
    undefined,
    "mysql",
    "script-db",
    "backend-fresh",
    "fresh-db; echo unsafe",
  ])
    assert.throws(() =>
      isolatedComposeArguments({ ...env, API_TEST_DATABASE: database }, root),
    );
});

test("显式参数非法时直接拒绝，不能回退省略覆盖文件", () => {
  for (const value of [
    "",
    "not-json",
    "null",
    "{}",
    '"docker compose"',
    "[1]",
    "[]",
  ])
    assert.throws(() =>
      isolatedComposeArguments(
        { ...env, MAYDAY_TEST_COMPOSE_ARGS: value },
        root,
      ),
    );
});

test("JSON 数组不能切换项目、日常文件、其他运行目录或增加 shell 参数", () => {
  const changedProject = [...native];
  changedProject[4] = "mayday-check-20261005110000-a1b2c4";
  const changedRoot = [...native];
  changedRoot[2] = resolve(root, "..");
  const changedBase = [...native];
  changedBase[6] = join(root, "compose.yaml");
  const changedOverride = [...native];
  changedOverride[8] = join(
    root,
    ".local",
    "baseline",
    "other-run",
    "native-compose.json",
  );
  for (const args of [
    changedProject,
    changedRoot,
    changedBase,
    changedOverride,
    [...native, "exec"],
    ["docker", ...native],
  ])
    assert.throws(() =>
      isolatedComposeArguments(
        { ...env, MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify(args) },
        root,
      ),
    );
});

test("旧布局模拟在无 JDBC 的容器与有 JDBC 的原生路径核对同一固定隔离库", () => {
  assert.equal(
    assertIsolatedDatabaseBinding("mayday_verify", env, root),
    "mayday_verify",
  );
  for (const hostname of ["127.0.0.1", "localhost", "[::1]"])
    assert.equal(
      assertIsolatedDatabaseBinding(
        "mayday_verify",
        {
          ...env,
          DB_URL:
            "jdbc:mysql://" +
            hostname +
            ":49152/mayday_verify?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai",
        },
        root,
      ),
      "mayday_verify",
    );
});

test("固定隔离库不从 JDBC 推导，实际库名与 JDBC 库名污染均拒绝", () => {
  for (const actual of [
    "mayday",
    "other_business",
    "mayday_verify;DELETE",
    "",
    null,
  ])
    assert.throws(() => assertIsolatedDatabaseBinding(actual, env, root));
  for (const supplied of [
    "jdbc:mysql://127.0.0.1:49152/mayday",
    "jdbc:mysql://127.0.0.1:49152/other_business",
    "jdbc:mysql://127.0.0.1:49152/",
    "jdbc:mysql://127.0.0.1:49152/%6dayday_verify",
    "jdbc:mysql://127.0.0.1:49152/mayday_verify/extra",
  ])
    assert.throws(() =>
      assertIsolatedDatabaseBinding(
        "mayday_verify",
        { ...env, DB_URL: supplied },
        root,
      ),
    );
});

test("原生 JDBC 拒绝远程主机、默认端口、内嵌凭证、片段及非 MySQL 格式", () => {
  for (const supplied of [
    "jdbc:mysql://production.example:3306/mayday_verify",
    "jdbc:mysql://127.0.0.1/mayday_verify",
    "jdbc:mysql://127.0.0.1:0/mayday_verify",
    "jdbc:mysql://user:password@127.0.0.1:49152/mayday_verify",
    "jdbc:mysql://127.0.0.1:49152/mayday_verify#other",
    "jdbc:postgresql://127.0.0.1:49152/mayday_verify",
    "mysql://127.0.0.1:49152/mayday_verify",
    "",
    null,
  ])
    assert.throws(() =>
      assertIsolatedDatabaseBinding(
        "mayday_verify",
        { ...env, DB_URL: supplied },
        root,
      ),
    );
});

test("即使库名正确，日常项目、其他服务及跨项目覆盖仍不能模拟旧布局", () => {
  for (const changed of [
    { ...env, API_TEST_COMPOSE_PROJECT: "mayday" },
    { ...env, API_TEST_DATABASE: "mysql" },
    { ...env, API_TEST_DATABASE: "script-db" },
    {
      ...env,
      MAYDAY_TEST_COMPOSE_ARGS: JSON.stringify([
        ...expected,
        "-f",
        "compose.yaml",
      ]),
    },
  ])
    assert.throws(() =>
      assertIsolatedDatabaseBinding("mayday_verify", changed, root),
    );
});
