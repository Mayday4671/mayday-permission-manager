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
