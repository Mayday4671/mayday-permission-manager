/** 生成器只在隔离临时工程操作；验证安全边界、注册一致性和统一 SQL，不修改日常源码。 */
import test from "node:test";
import assert from "node:assert/strict";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  createGenerationPlan,
  applyGenerationPlan,
  validateModule,
} from "../scripts/generate-module.mjs";

const source = JSON.parse(
  readFileSync(
    new URL("../tools/generator/examples/workorder.json", import.meta.url),
  ),
);
const configuration = () => ({
  ...structuredClone(source),
  module: "inventory",
  resource: "inventory",
  entity: "InventoryItem",
  table: "biz_inventory_item",
  label: "物资管理",
  singular: "物资",
});
const files = [
  "backend/pom.xml",
  "backend/mayday-application/pom.xml",
  "backend/mayday-security/src/main/java/com/mayday/security/PermissionCatalog.java",
  "backend/mayday-application/src/main/java/com/mayday/service/NavigationCatalog.java",
  "backend/mayday-common/src/main/java/com/mayday/common/ModuleSwitches.java",
  "backend/mayday-application/src/main/resources/application.yml",
  "compose.yaml",
  "compose.verify.yaml",
  ".env.example",
  "frontend/src/lib/workspace-model.ts",
  "frontend/src/lib/module-model.ts",
  "frontend/src/App.tsx",
  "database/mayday.sql",
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mayday-generator-"));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(
      join(root, file),
      readFileSync(new URL(`../${file}`, import.meta.url)),
    );
  }
  return root;
}

test("危险路径、保留字段、重复字段和代码注入不能生成", () => {
  for (const mutation of [
    (value) => (value.module = "../escape"),
    (value) => (value.table = "biz_item; DROP TABLE sys_user"),
    (value) => (value.label = '标题"; malicious()'),
    (value) => value.fields.push({ ...value.fields[0] }),
    (value) => (value.fields[0].name = "ownerId"),
    (value) => (value.fields[0].name = "class"),
    (value) => (value.fields[0].maxLength = 999999),
    (value) => (value.fields[0].type = "rawSql"),
    (value) => (value.fields[0].required = "true"),
    (value) => (value.fields = []),
  ]) {
    const input = configuration();
    mutation(input);
    assert.throws(() => validateModule(input));
  }
});

test("预览不写入；执行生成模块、权限、菜单、开关、页面、迁移及测试", () => {
  const root = fixture();
  const before = readFileSync(join(root, "database/mayday.sql"), "utf8");
  const plan = createGenerationPlan(root, configuration());
  assert.equal(readFileSync(join(root, "database/mayday.sql"), "utf8"), before);
  assert.equal(
    readdirSync(join(root, "backend")).includes("mayday-inventory"),
    false,
  );
  applyGenerationPlan(root, plan);
  for (const file of [
    "backend/mayday-inventory/src/main/java/com/mayday/inventory/InventoryItemService.java",
    "backend/mayday-inventory/src/test/java/com/mayday/inventory/InventoryItemServiceTest.java",
    "frontend/src/pages/business/InventoryItemPage.tsx",
  ])
    assert.ok(readFileSync(join(root, file), "utf8"));
  const service = readFileSync(
    join(
      root,
      "backend/mayday-inventory/src/main/java/com/mayday/inventory/InventoryItemService.java",
    ),
    "utf8",
  );
  assert.match(service, /access\.checkData\("inventory"/);
  assert.match(service, /EntityVersions\.requireCurrent/);
  assert.match(service, /entity\.setOwnerId\(access\.current\(\)\.getId\(\)\)/);
  const pageSource = readFileSync(
    join(root, "frontend/src/pages/business/InventoryItemPage.tsx"),
    "utf8",
  );
  const parsed = ts.createSourceFile(
    "InventoryItemPage.tsx",
    pageSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  assert.deepEqual(
    parsed.parseDiagnostics,
    [],
    "生成页面必须能被 TypeScript 正确解析",
  );
  const sql = readFileSync(join(root, "database/mayday.sql"), "utf8");
  assert.match(sql, /CREATE TABLE `biz_inventory_item`/);
  const version =
    Number(/VALUES \(1, '(\d+)', '<< Flyway Baseline >>'/.exec(before)[1]) + 1;
  assert.match(
    sql,
    new RegExp(`VALUES \\(1, '${version}', '<< Flyway Baseline >>'`),
  );
  assert.match(sql, /VALUES \(1, '\d+', '<< Flyway Baseline >>', 'BASELINE'/);
  assert.equal((sql.match(/SELECT 'menus','物资管理'/g) ?? []).length, 1);
  const migration = readFileSync(
    join(
      root,
      `backend/mayday-application/src/main/resources/db/migration/V${version}__inventory.sql`,
    ),
    "utf8",
  );
  assert.ok(sql.includes(migration.split("-- 只补建导航")[0].trim()));
  assert.throws(() => createGenerationPlan(root, configuration()), /已存在/);
});

test("标记缺失和预览后编辑都拒绝写入，不生成半套工程", () => {
  const root = fixture();
  const plan = createGenerationPlan(root, configuration());
  writeFileSync(join(root, "backend/pom.xml"), "changed");
  assert.throws(() => applyGenerationPlan(root, plan), /已过期/);
  assert.equal(
    readdirSync(join(root, "backend")).includes("mayday-inventory"),
    false,
  );
  assert.throws(() => createGenerationPlan(root, configuration()), /标记/);
});
