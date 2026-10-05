/** 开发启动配置测试只使用内存对象，不读取真实 .env、不连接 Docker，也不启动或停止任何服务。 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  parseDevelopmentEnvironment,
  developmentConfiguration,
  assertDevelopmentProcess,
} from "../scripts/development-configuration.mjs";

const settings = {
  MYSQL_ROOT_PASSWORD: "root-fixture-only",
  MYSQL_PASSWORD: "db-fixture-only",
  ADMIN_PASSWORD: "admin-fixture-only",
};
const root = resolve("development-fixture");

test(".env 支持 OIDC 数字索引和字面量密码，拒绝重复、非法及未闭合配置", () => {
  assert.deepEqual(
    parseDevelopmentEnvironment(
      '\uFEFF# 注释\nMAYDAY_IDENTITY_PROVIDERS_0_ID=enterprise\nMAYDAY_IDENTITY_PROVIDERS_12_CLIENTSECRET="$literal#`value=tail"\nMAYDAY_PUBLIC_ORIGIN=\n',
    ),
    {
      MAYDAY_IDENTITY_PROVIDERS_0_ID: "enterprise",
      MAYDAY_IDENTITY_PROVIDERS_12_CLIENTSECRET: "$literal#`value=tail",
      MAYDAY_PUBLIC_ORIGIN: "",
    },
  );
  for (const input of ["KEY=one\nKEY=two", "not a setting", 'KEY="missing'])
    assert.throws(() => parseDevelopmentEnvironment(input));
});

test("Java 完整传递模块、存储、会话、MFA 及多 OIDC 配置，隔离宿主 Spring/JVM/云凭据", () => {
  const configured = {
    ...settings,
    SEED_DEMO_DATA: "false",
    MODULE_CRAWLER_ENABLED: "false",
    MODULE_WORKORDERS_ENABLED: "true",
    MAYDAY_STORAGE_MODE: "S3",
    MAYDAY_STORAGE_S3_SECRET_KEY: "configured-s3-only",
    MAYDAY_PRODUCTION: "true",
    MAYDAY_PUBLIC_ORIGIN: "https://example.test",
    API_DOCS_ENABLED: "false",
    MAYDAY_SESSION_IDLE_MINUTES: "20",
    MAYDAY_MFA_ENABLED: "true",
    MAYDAY_IDENTITY_ENCRYPTION_KEY: "configured-key-only",
    MAYDAY_IDENTITY_PROVIDERS_1_CLIENTSECRET: "configured-oidc-only",
  };
  const host = {
    Path: "system-path",
    TEMP: "system-temp",
    SPRING_DATASOURCE_URL: "other-db",
    SPRING_APPLICATION_JSON: "other-settings",
    JAVA_TOOL_OPTIONS: "-Dserver.port=1",
    JDK_JAVA_OPTIONS: "-Dspring.datasource.url=other",
    DB_URL: "other-db",
    MAYDAY_STORAGE_MODE: "LOCAL",
    AWS_SECRET_ACCESS_KEY: "other-cloud",
    MODULE_CRAWLER_ENABLED: "true",
    MYSQL_DATABASE: "other-db",
    COMPOSE_FILE: "other-compose",
  };
  const result = developmentConfiguration(root, configured, host);
  for (const [key, value] of Object.entries(configured))
    if (!key.startsWith("MYSQL_"))
      assert.equal(result.javaEnvironment[key], value);
  for (const key of [
    "SPRING_DATASOURCE_URL",
    "SPRING_APPLICATION_JSON",
    "JAVA_TOOL_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "AWS_SECRET_ACCESS_KEY",
    "MYSQL_ROOT_PASSWORD",
  ])
    assert.equal(result.javaEnvironment[key], undefined);
  assert.equal(
    result.javaEnvironment.DB_URL,
    "jdbc:mysql://127.0.0.1:13306/mayday?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai",
  );
  assert.equal(
    result.javaEnvironment.MAYDAY_STORAGE_LOCAL_ROOT,
    resolve(root, "data/files"),
  );
  assert.equal(result.dockerEnvironment.MYSQL_DATABASE, undefined);
  assert.equal(result.dockerEnvironment.COMPOSE_FILE, undefined);
  assert.equal(result.dockerEnvironment.MODULE_CRAWLER_ENABLED, "false");
  assert.equal(
    result.frontendEnvironment.VITE_API_TARGET,
    "http://127.0.0.1:18080",
  );
  assert.equal(result.frontendEnvironment.ADMIN_PASSWORD, undefined);
  assert.equal(host.Path, "system-path");
});

test("显式配置不能覆盖 Spring/JVM/Compose；远程或另一项目数据库、绑定地址与冲突端口失败", () => {
  for (const key of [
    "SPRING_APPLICATION_JSON",
    "JAVA_TOOL_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "COMPOSE_FILE",
    "COMPOSE_PROJECT_NAME",
  ])
    assert.throws(() => parseDevelopmentEnvironment(`${key}=forbidden`));
  for (const additional of [
    { DB_URL: "jdbc:mysql://remote:13306/mayday" },
    { DB_URL: "jdbc:mysql://127.0.0.1:13306/mayday_other" },
    { DB_URL: "jdbc:mysql://127.0.0.1:13307/mayday" },
    { DB_USERNAME: "other-user" },
    { DB_PASSWORD: "other-password" },
    { API_PORT: "15173" },
    { DB_PORT: "0" },
    { WEB_PORT: "65536" },
    { SERVER_ADDRESS: "0.0.0.0" },
    { MYSQL_DATABASE: "mayday;other" },
  ])
    assert.throws(() =>
      developmentConfiguration(root, { ...settings, ...additional }, {}),
    );
});

test("自定义本机端口和文件根目录保持一致，不迁移旧目录或修改宿主环境", () => {
  const result = developmentConfiguration(
    root,
    {
      ...settings,
      DB_PORT: "14306",
      API_PORT: "19080",
      WEB_PORT: "16173",
      MYSQL_DATABASE: "fixture_database",
      MAYDAY_STORAGE_LOCAL_ROOT: "existing-files",
      MAYDAY_BULK_SPOOL_DIRECTORY: "existing-cache",
      DB_URL: "jdbc:mysql://127.0.0.1:14306/fixture_database?useSSL=false",
    },
    {},
  );
  assert.equal(result.javaEnvironment.SERVER_ADDRESS, "127.0.0.1");
  assert.equal(result.javaEnvironment.SERVER_PORT, "19080");
  assert.equal(
    result.javaEnvironment.MAYDAY_STORAGE_LOCAL_ROOT,
    resolve(root, "existing-files"),
  );
  assert.equal(
    result.javaEnvironment.MAYDAY_BULK_SPOOL_DIRECTORY,
    "existing-cache",
  );
  assert.equal(
    result.frontendEnvironment.VITE_API_TARGET,
    "http://127.0.0.1:19080",
  );
});

test("停止核对完整运行参数和创建时间，不以目录包含关系停止复用 PID", () => {
  const jar = resolve(root, ".local/mayday-runtime.jar");
  const information = {
    ProcessId: 123,
    Name: "java.exe",
    CommandLine: `java.exe -jar "${jar}" --spring.config.location=classpath:/application.yml`,
    ExecutablePath: "C:/java/bin/java.exe",
    CreatedAt: "2026-10-05T00:00:00.000Z",
  };
  const record = {
    identities: {
      backend: {
        pid: 123,
        executable: information.ExecutablePath,
        createdAt: information.CreatedAt,
      },
    },
  };
  assertDevelopmentProcess(record, "backend", information, root);
  assertDevelopmentProcess({}, "backend", information, root);
  assertDevelopmentProcess(record, "backend", null, root);
  for (const changed of [
    { Name: "node.exe" },
    { CommandLine: `java.exe -jar "${jar}-other"` },
    { CommandLine: `java.exe -Dnote="${root}" -jar other.jar` },
    { CreatedAt: "2026-10-06T00:00:00.000Z" },
    { ExecutablePath: "C:/other/java.exe" },
  ])
    assert.throws(() =>
      assertDevelopmentProcess(
        record,
        "backend",
        { ...information, ...changed },
        root,
      ),
    );
});
