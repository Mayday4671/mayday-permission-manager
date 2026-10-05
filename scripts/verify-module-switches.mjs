/** 在基线创建的独立数据库启动裁剪实例，检查真实 HTTP、管理员权限、导航和模块依赖。 */
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  moduleProfiles,
  verifyModuleProfile,
} from "./module-switch-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.env.API_TEST_COMPOSE_PROJECT;
assert.match(
  project ?? "",
  /^mayday-check-[a-z0-9-]+$/,
  "只能在独立基线项目运行模块裁剪验收",
);
const port = process.env.VERIFY_MODULE_PORT ?? "18083";
assert.match(port, /^\d{4,5}$/);
const container = `${project}-module-switches`;
const base = `http://127.0.0.1:${port}/api`;
function docker(args) {
  const response = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
  });
  if (response.status !== 0 || response.error)
    throw new Error("独立模块验收容器操作失败", { cause: response.error });
  return response.stdout;
}
for (const profile of moduleProfiles) {
  let created = false;
  try {
    docker([
      "compose",
      "-p",
      project,
      "-f",
      join(root, "compose.verify.yaml"),
      "run",
      "--no-deps",
      "-d",
      "--name",
      container,
      "-p",
      `127.0.0.1:${port}:8080`,
      ...Object.entries(profile.flags).flatMap(([key, value]) => [
        "-e",
        `MODULE_${key}_ENABLED=${value}`,
      ]),
      "backend-fresh",
    ]);
    created = true;
    let healthy = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      healthy = await fetch(`http://127.0.0.1:${port}/actuator/health`, {
        signal: AbortSignal.timeout(3000),
      })
        .then((response) => response.ok)
        .catch(() => false);
      if (healthy) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    assert.ok(healthy, "裁剪配置无法正常启动");
    await verifyModuleProfile(base, process.env.VERIFY_ADMIN_PASSWORD, profile);
    console.log(`通过模块开关：${profile.name}`);
  } finally {
    if (created) docker(["rm", "-f", container]);
  }
}
