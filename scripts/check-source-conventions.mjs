import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

/** 规范检查覆盖全部手写新旧源码；生成类型不要求手工改注释，Java使用语法树而非文本猜测。 */
const reportOnly = process.argv.includes("--report");
const files = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "generated") collect(path);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(path);
  }
}
collect("frontend/src");
const failures = [];
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function inspect(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword)
      failures.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} 禁止用any绕过业务类型`,
      );
    const exportedFunction =
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    if (
      exportedFunction &&
      !ts
        .getJSDocCommentsAndTags(node)
        .some(
          (comment) =>
            typeof comment.comment === "string" &&
            comment.comment.trim().length >= 8,
        )
    )
      failures.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} 公开边界 ${node.name?.text ?? "default"} 缺职责说明`,
      );
    ts.forEachChild(node, inspect);
  }
  inspect(source);
}
failures.forEach((failure) => process.stdout.write(`${failure}\n`));
const javaExecutable = process.env.JAVA_HOME
  ? join(
      process.env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
const java = spawnSync(
  javaExecutable,
  ["tools/quality/SourceConventions.java", ...(reportOnly ? ["--report"] : [])],
  { stdio: "inherit", windowsHide: true },
);
if (java.error)
  process.stderr.write(`无法运行 Java 规范检查：${java.error.message}\n`);
process.stdout.write(
  `手写前端源码 ${files.length} 文件；待处理 ${failures.length} 处。\n`,
);
if (
  java.error ||
  java.status === null ||
  (!reportOnly && (failures.length || java.status !== 0))
)
  process.exitCode = 1;
