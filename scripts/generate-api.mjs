/**
 * 从运行中的真实后端导出 OpenAPI，再生成 TypeScript。--check 只比较，不写入文件。
 * --offline 只检查已提交契约和类型的一致性，适用于前端构建和生成器预检。
 * 管理员凭证只来自环境变量或忽略的 .env，不出现在命令行、契约、输出和 Git 中。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, {
  astToString,
} from "../frontend/node_modules/openapi-typescript/dist/index.mjs";
import { format } from "../frontend/node_modules/prettier/index.mjs";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaFile = join(root, "contracts/openapi.json");
const typeFile = join(root, "frontend/src/types/generated/api.ts");
const args = process.argv.slice(2);
if (args.some((arg) => !["--check", "--offline"].includes(arg)))
  throw new Error("支持 --check、--offline");

export function canonicalize(value, key = "") {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => canonicalize(item));
    return key === "required" ? normalized.sort() : normalized;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((name) => [name, canonicalize(value[name], name)]),
    );
  return value;
}

let schema;
if (args.includes("--offline"))
  schema = JSON.parse(readFileSync(schemaFile, "utf8"));
else {
  const settings = existsSync(join(root, ".env"))
    ? Object.fromEntries(
        readFileSync(join(root, ".env"), "utf8")
          .split(/\r?\n/)
          .filter((line) => /^[A-Z_]+=/.test(line))
          .map((line) => {
            const index = line.indexOf("=");
            return [
              line.slice(0, index),
              line
                .slice(index + 1)
                .trim()
                .replace(/^(["'])(.*)\1$/, "$2"),
            ];
          }),
      )
    : {};
  const password = process.env.ADMIN_PASSWORD ?? settings.ADMIN_PASSWORD;
  if (!password) throw new Error("缺少 ADMIN_PASSWORD，不能读取管理员接口契约");
  const base = process.env.API_BASE ?? "http://127.0.0.1:18080/api";
  const session = await loginWithCaptcha(base, "admin", password);
  try {
    const response = await fetch(base + "/platform/openapi", {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`契约读取失败：HTTP ${response.status}`);
    schema = await response.json();
  } finally {
    const logout = await fetch(base + "/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!logout.ok) throw new Error("契约导出会话撤销失败");
  }
}
if (
  !schema?.openapi?.startsWith("3.") ||
  !schema.paths ||
  !schema.components?.schemas
)
  throw new Error("后端未返回合法 OpenAPI 契约");
const contract = JSON.stringify(canonicalize(schema), null, 2) + "\n";
const types = await format(
  "/** 自动从 contracts/openapi.json 生成；请修改服务端 DTO 后重新生成，禁止手工编辑。 */\n" +
    astToString(await openapiTS(JSON.parse(contract), { alphabetize: true })),
  { parser: "typescript" },
);
if (args.includes("--check")) {
  if (readFileSync(schemaFile, "utf8") !== contract)
    throw new Error("后端契约已变化，请生成并提交 contracts/openapi.json");
  if (readFileSync(typeFile, "utf8") !== types)
    throw new Error("前端接口类型已过期，请重新生成");
  console.log(
    `契约一致：${Object.keys(schema.paths).length} 个路径，TypeScript 类型已同步`,
  );
} else {
  mkdirSync(dirname(schemaFile), { recursive: true });
  mkdirSync(dirname(typeFile), { recursive: true });
  writeFileSync(schemaFile, contract, "utf8");
  writeFileSync(typeFile, types, "utf8");
  console.log(`已生成契约与类型：${Object.keys(schema.paths).length} 个路径`);
}
