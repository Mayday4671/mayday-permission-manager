import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deploymentFingerprint,
  assertVerifiedInputs,
} from "../scripts/deployment-inputs.mjs";
import { fileManifest, assertRestoredFiles } from "../scripts/file-backup.mjs";
import {
  javaRuntimeEnvironment,
  isLocalDockerEndpoint,
} from "../scripts/runtime-environment.mjs";
import {
  preservedBusinessColumns,
  snapshotJsonFields,
} from "../scripts/migration-snapshot.mjs";

test("本机数据库验收拒绝远程 Docker 与另一台机器的命名管道", () => {
  assert(
    isLocalDockerEndpoint("npipe:////./pipe/dockerDesktopLinuxEngine", "win32"),
  );
  assert(isLocalDockerEndpoint("unix:///var/run/docker.sock", "linux"));
  for (const endpoint of [
    "tcp://127.0.0.1:2375",
    "ssh://remote",
    "npipe:////remote/pipe/docker_engine",
    "unix:///var/run/docker.sock?remote=true",
  ])
    for (const platform of ["win32", "linux"])
      assert.equal(isLocalDockerEndpoint(endpoint, platform), false);
});

test("迁移前快照包含原 OA 历史、正文、门户、身份及后续模块，不以迁移后基线替代", () => {
  const names = [
    "ops_flow_request",
    "ops_flow_decision",
    "ops_flow_version",
    "cms_revision",
    "cms_publication",
    "cms_portal_home",
    "ops_file_payload",
    "sys_mfa_credential",
    "future_business_module",
    "sys_session",
    "sys_audit_log",
    "sys_identity_challenge",
  ];
  const columns = preservedBusinessColumns(
    names.map((name) => ({
      name,
      columns: [{ name: "id" }, { name: "original_blob" }],
    })),
  );
  for (const name of names.slice(0, 9))
    assert.equal(columns[name], "id,original_blob");
  for (const name of names.slice(9)) assert.equal(columns[name], undefined);
  const sql = snapshotJsonFields("ops_file_payload", "id,content");
  assert(
    sql.includes("JSON_ARRAY") &&
      sql.includes("HEX(CAST((`content`) AS BINARY))") &&
      sql.includes("IS NULL,NULL"),
  );
  assert.throws(
    () => snapshotJsonFields("ops_file_payload", "id,content;DELETE"),
    /列名不合法/,
  );
});

test("隔离 Java 不继承宿主数据库覆盖、JVM 注入或云存储凭据，只接受明确应用配置", () => {
  const environment = javaRuntimeEnvironment(
    {
      Path: "system-bin",
      JAVA_HOME: "java-home",
      TEMP: "private-temp",
      LANG: "zh_CN.UTF-8",
      SPRING_DATASOURCE_URL: "production-database",
      SPRING_APPLICATION_JSON: "production-config",
      spring_config_location: "other-project",
      JAVA_TOOL_OPTIONS: "-Dspring.datasource.url=production",
      _JAVA_OPTIONS: "-Dmayday.storage.mode=S3",
      JDK_JAVA_OPTIONS: "-Dserver.port=1234",
      DB_URL: "other-database",
      MAYDAY_STORAGE_MODE: "S3",
      MAYDAY_STORAGE_S3_SECRET_KEY: "private-key",
      AWS_SECRET_ACCESS_KEY: "cloud-private-key",
      ADMIN_PASSWORD: "other-password",
    },
    {
      DB_URL: "owned-database",
      ADMIN_PASSWORD: "owned-password",
      MAYDAY_STORAGE_MODE: "LOCAL",
      SERVER_PORT: 12345,
    },
  );
  assert.deepEqual(environment, {
    Path: "system-bin",
    JAVA_HOME: "java-home",
    TEMP: "private-temp",
    LANG: "zh_CN.UTF-8",
    DB_URL: "owned-database",
    ADMIN_PASSWORD: "owned-password",
    MAYDAY_STORAGE_MODE: "LOCAL",
    SERVER_PORT: "12345",
  });
});

test("显式 Java 配置不能重新引入 Spring 或 JVM 高优先级覆盖入口", () => {
  for (const key of [
    "SPRING_DATASOURCE_URL",
    "spring_application_json",
    "SPRING_CONFIG_IMPORT",
    "JAVA_TOOL_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "JAVA_OPTS",
    "_JAVA_OPTIONS",
    "spring.datasource.url",
  ])
    assert.throws(
      () => javaRuntimeEnvironment({}, { [key]: "unsafe" }),
      /配置入口不被允许/,
    );
});

/** 所有夹具放入本次创建的临时目录；仅清理这些目录，不操作真实业务数据或 Docker 数据卷。 */
test("发布门槛拒绝未重新验收的源码、检查和配置改动，同时忽略凭证及构建产物", () => {
  const root = mkdtempSync(join(tmpdir(), "mayday-delivery-"));
  try {
    mkdirSync(join(root, "backend", "target"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "backend", "pom.xml"), "original");
    writeFileSync(join(root, "scripts", "check.mjs"), "check");
    const verified = deploymentFingerprint(root);
    writeFileSync(join(root, ".env"), "private");
    writeFileSync(join(root, "backend", "target", "app.jar"), "generated");
    assertVerifiedInputs(verified, deploymentFingerprint(root));
    for (const path of [
      "backend/pom.xml",
      "scripts/check.mjs",
      "compose.yaml",
      "backend/New.java",
    ]) {
      writeFileSync(join(root, path), "changed");
      assert.throws(
        () => assertVerifiedInputs(verified, deploymentFingerprint(root)),
        /重新完成隔离验收/,
      );
    }
    assert.throws(
      () => assertVerifiedInputs(undefined, deploymentFingerprint(root)),
      /重新完成隔离验收/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("文件恢复验证逐个核对正文和路径，损坏、缺失和额外文件均不能通过", () => {
  const root = mkdtempSync(join(tmpdir(), "mayday-file-recovery-"));
  try {
    const source = join(root, "source");
    const restored = join(root, "restored");
    mkdirSync(join(source, "ab"), { recursive: true });
    writeFileSync(join(source, "ab", "one"), Buffer.from([0, 255, 100, 5]));
    writeFileSync(join(source, "two"), "测试正文");
    cpSync(source, restored, { recursive: true });
    const before = fileManifest(source);
    assert.equal(before.files.length, 2);
    assertRestoredFiles(before, fileManifest(restored));
    writeFileSync(join(restored, "ab", "one"), Buffer.from([0, 255, 100, 6]));
    assert.throws(
      () => assertRestoredFiles(before, fileManifest(restored)),
      /摘要不一致/,
    );
    rmSync(join(restored, "ab", "one"));
    assert.throws(
      () => assertRestoredFiles(before, fileManifest(restored)),
      /摘要不一致/,
    );
    writeFileSync(join(restored, "extra"), "额外正文");
    assert.throws(
      () => assertRestoredFiles(before, fileManifest(restored)),
      /摘要不一致/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
