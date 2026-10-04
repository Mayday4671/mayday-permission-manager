import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// 只包含交付及验收输入。运行产物、备份、凭证与截图不能混入构建身份。
const directories = [
  "backend",
  "frontend",
  "contracts",
  "database",
  "scripts",
  "tests",
  "tools",
  ".github",
];
const files = [
  "compose.yaml",
  "compose.verify.yaml",
  ".env.example",
  ".prettierrc.json",
  ".prettierignore",
];
const ignored = new Set([
  "target",
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
  "coverage",
  ".vite",
  ".git",
  ".local",
]);

/** 对当前工作区的构建与测试输入计算稳定摘要；包含尚未提交的新源码，不读取 .env 或运行目录。 */
export function deploymentFingerprint(root) {
  const paths = [];
  function visit(path) {
    if (
      /(?:^|\/)data\/files(?:\/|$)/.test(
        relative(root, path).replaceAll("\\", "/"),
      )
    )
      return;
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink())
      throw new Error("交付输入不允许符号链接：" + relative(root, path));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (
          !ignored.has(entry) &&
          !/^(?:\.env(?:\..*)?|.*\.(?:log|tsbuildinfo))$/.test(entry)
        )
          visit(join(path, entry));
      }
    } else if (stat.isFile()) paths.push(path);
    else throw new Error("交付输入包含非常规文件：" + relative(root, path));
  }
  for (const name of [...directories, ...files]) visit(join(root, name));
  const hash = createHash("sha256");
  for (const path of paths.sort((a, b) =>
    relative(root, a)
      .replaceAll("\\", "/")
      .localeCompare(relative(root, b).replaceAll("\\", "/"), "en"),
  )) {
    const content = readFileSync(path);
    hash.update(
      relative(root, path).replaceAll("\\", "/") + "\0" + content.length + "\0",
    );
    hash.update(content);
  }
  return { version: 1, sha256: hash.digest("hex"), files: paths.length };
}

/** 升级必须使用同一组源码与检查输入；缺少摘要的历史验收不能作为新版本发布门槛。 */
export function assertVerifiedInputs(verified, current) {
  if (
    verified?.version !== current.version ||
    verified.sha256 !== current.sha256 ||
    verified.files !== current.files
  )
    throw new Error(
      "源码、配置模板或验收脚本已变化，请重新完成隔离验收后再升级",
    );
}
