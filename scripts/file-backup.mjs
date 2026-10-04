import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** 为本地文件正文建立逐文件摘要；拒绝符号链接，不读取根目录之外的路径或记录文件正文。 */
export function fileManifest(root) {
  const files = [];
  function visit(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("文件备份不允许符号链接");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else if (stat.isFile()) {
      files.push({
        path: relative(root, path).replaceAll("\\", "/"),
        bytes: stat.size,
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    } else throw new Error("文件备份包含非常规文件");
  }
  visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return {
    version: 1,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
}

/** 摘要必须完全匹配，拒绝缺失、增加或损坏的文件；调用者只在隔离容器内恢复，不能覆盖日常卷。 */
export function assertRestoredFiles(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("本地文件恢复与备份摘要不一致");
}
