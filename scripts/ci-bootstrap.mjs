/** CI 首次启动需要独立配置。生成的随机凭证仅写入忽略的 .env，不打印或上传。 */
import { writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";

assert.equal(
  process.env.CI,
  "true",
  "此入口仅用于 CI；本地请按 .env.example 配置",
);
assert.equal(existsSync(".env"), false, "拒绝覆盖已有环境配置");
const password = () => `Ci_${randomBytes(24).toString("hex")}!`;
writeFileSync(
  ".env",
  `MYSQL_ROOT_PASSWORD=${password()}\nMYSQL_PASSWORD=${password()}\nADMIN_PASSWORD=${password()}\nSEED_DEMO_DATA=false\n`,
  { mode: 0o600, flag: "wx" },
);
console.log("已创建 CI 隔离环境配置");
