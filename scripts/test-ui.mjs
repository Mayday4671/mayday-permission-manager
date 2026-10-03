/** 统一发现全部前端回归用例；新增测试无需手动维护另一个清单，子进程失败原样传播。 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const files = readdirSync(resolve(frontend, "tests"))
  .filter((name) => /\.test\.tsx?$/.test(name))
  .sort()
  .map((name) => "tests/" + name);
const result = spawnSync(
  process.execPath,
  // 与完整工程检查保持相同并发预算，仍逐文件隔离并执行全部断言。
  ["--import", "tsx", "--test", "--test-concurrency=2", ...files],
  {
    cwd: frontend,
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
