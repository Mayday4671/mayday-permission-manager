/** 跨平台工程检查入口；子进程使用参数数组，不拼接业务数据或数据库凭证到 shell。 */
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(root, "frontend");
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error(`工程检查未通过：${command}`, { cause: result.error });
}
run(process.execPath, ["scripts/check-source-conventions.mjs"]);
run(process.execPath, [
  join(frontend, "node_modules/prettier/bin/prettier.cjs"),
  "--check",
  "scripts",
  "tests",
  "tools/generator/examples",
  "*.yaml",
  ".github/workflows",
]);
run(
  process.execPath,
  [
    join(frontend, "node_modules/prettier/bin/prettier.cjs"),
    "--check",
    "src",
    "tests",
    "vite.config.ts",
  ],
  frontend,
);
run(process.execPath, ["scripts/generate-api.mjs", "--offline", "--check"]);
run(process.execPath, [
  "--test",
  "tests/workspace.test.mjs",
  "tests/admin-ui-model.test.mjs",
  "tests/usability-model.test.mjs",
  "tests/portal-routing.test.mjs",
  "tests/module-model.test.mjs",
  "tests/theme-model.test.mjs",
  "tests/generator.test.mjs",
  "tests/delivery-tools.test.mjs",
  "tests/development-configuration.test.mjs",
  "tests/isolated-compose.test.mjs",
  "tests/cluster-release-gate.test.mjs",
  "tests/verification-diagnostics.test.mjs",
]);
run(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    // Ant/jsdom 套件开销较高，限制文件并发，避免按宿主机核心数同时渲染导致等待断言失真。
    "--test-concurrency=2",
    ...readdirSync(join(frontend, "tests"))
      .filter((file) => /\.test\.tsx?$/.test(file))
      .map((file) => join("tests", file)),
  ],
  frontend,
);
run(
  process.execPath,
  [join(frontend, "node_modules/typescript/bin/tsc"), "-b"],
  frontend,
);
run(
  process.execPath,
  [join(frontend, "node_modules/vite/bin/vite.js"), "build"],
  frontend,
);
