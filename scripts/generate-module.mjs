/**
 * 安全的业务模块生成入口。默认只列出计划，--apply 才写文件；不连接数据库、不启动服务。
 * 所有目标先验证后写入，不覆盖已有模块；失败时只回滚本次写入，不删除用户目录。
 * 模板集中在 tools/generator/templates，模块注册通过显式标记完成，避免猜测代码位置。
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  lstatSync,
  globSync,
} from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = join(repositoryRoot, "tools/generator/templates");
const reservedFields = new Set([
  "id",
  "ownerId",
  "departmentId",
  "createdAt",
  "updatedAt",
  "version",
  "class",
  "package",
  "import",
  "default",
  "return",
  "public",
  "private",
  "protected",
  "static",
  "final",
  "new",
  "this",
  "void",
  "interface",
  "enum",
  "record",
  "null",
  "true",
  "false",
  "const",
  "let",
  "var",
  "function",
  "switch",
  "case",
  "throw",
  "try",
  "catch",
  "while",
  "for",
  "delete",
  "extends",
  "super",
  "yield",
  "instanceof",
  "synchronized",
  "abstract",
  "native",
  "boolean",
  "byte",
  "char",
  "double",
  "float",
  "int",
  "long",
  "short",
  "assert",
  "break",
  "continue",
  "do",
  "if",
  "else",
  "throws",
  "volatile",
  "transient",
  "implements",
  "strictfp",
  "sealed",
  "permits",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);
const safeLabel = /^[\p{L}\p{N} ·（）()_-]{1,40}$/u;
const snakeCase = (value) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const capitalize = (value) => value[0].toUpperCase() + value.slice(1);

/** 只开放确定的字段类型和命名规则；标识符不能注入 Java、SQL、TS 或文件路径。 */
export function validateModule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("模块配置必须是对象");
  const allowedKeys = [
    "module",
    "entity",
    "resource",
    "label",
    "singular",
    "table",
    "fields",
  ];
  if (Object.keys(input).some((key) => !allowedKeys.includes(key)))
    throw new Error("存在未知模块配置项");
  for (const key of ["module", "resource"]) {
    if (!/^[a-z][a-z0-9]{2,31}$/.test(input[key] ?? ""))
      throw new Error(`${key} 必须是小写英文和数字`);
    if (
      [
        "system",
        "auth",
        "public",
        "platform",
        "content",
        "portal",
        "notifications",
        "approvals",
        "crawler",
        "udp",
        "scheduler",
      ].includes(input[key])
    )
      throw new Error("不能使用内置模块名称");
  }
  if (
    !/^[A-Z][a-zA-Z0-9]{2,39}$/.test(input.entity ?? "") ||
    reservedFields.has(input.entity.toLowerCase())
  )
    throw new Error("entity 必须使用 PascalCase");
  if (!/^biz_[a-z][a-z0-9_]{2,45}$/.test(input.table ?? ""))
    throw new Error("table 必须以 biz_ 开头并使用小写下划线命名");
  for (const key of ["label", "singular"])
    if (!safeLabel.test(input[key] ?? ""))
      throw new Error(`${key} 包含不支持的字符`);
  if (
    !Array.isArray(input.fields) ||
    input.fields.length < 2 ||
    input.fields.length > 20
  )
    throw new Error("fields 需要 2 至 20 个字段");
  const names = new Set();
  for (const field of input.fields) {
    if (
      !field ||
      typeof field !== "object" ||
      Object.keys(field).some(
        (key) =>
          !["name", "label", "type", "maxLength", "required"].includes(key),
      )
    )
      throw new Error("存在未知字段配置项");
    if (
      !/^[a-z][a-zA-Z0-9]{0,39}$/.test(field.name ?? "") ||
      reservedFields.has(field.name) ||
      names.has(field.name)
    )
      throw new Error("字段名称重复、保留或不符合 camelCase");
    names.add(field.name);
    if (
      !safeLabel.test(field.label ?? "") ||
      typeof field.required !== "boolean"
    )
      throw new Error("字段标签或 required 不合法");
    if (!["string", "integer", "boolean"].includes(field.type))
      throw new Error("目前支持 string、integer、boolean");
    if (
      field.type === "string" &&
      (!Number.isInteger(field.maxLength) ||
        field.maxLength < 1 ||
        field.maxLength > 2000)
    )
      throw new Error("字符串 maxLength 范围为 1 至 2000");
    if (
      field.type !== "string" &&
      (field.maxLength !== undefined || !field.required)
    )
      throw new Error("数值和布尔字段必须 required=true，且不能指定 maxLength");
  }
  if (
    !input.fields.some(
      (field) =>
        field.name === "title" && field.type === "string" && field.required,
    ) ||
    !input.fields.some(
      (field) => field.name === "enabled" && field.type === "boolean",
    )
  )
    throw new Error("标准列表需要必填 title 和 enabled 字段");
  const estimatedRowBytes = input.fields.reduce(
    (total, field) =>
      total + (field.type === "string" ? field.maxLength * 4 : 8),
    256,
  );
  if (estimatedRowBytes > 60000)
    throw new Error(
      "字段估算行长超出 MySQL 安全范围，请拆分表或设计 TEXT 字段",
    );
  return structuredClone(input);
}

/** 路径始终限定在目标工程，逐级拒绝符号链接，防止通过目录链接写入工程外。 */
function safeTarget(root, name) {
  const target = resolve(root, name);
  const inside = relative(root, target);
  if (!inside || inside.startsWith(`..${sep}`) || inside === "..")
    throw new Error("目标越出工程目录");
  let cursor = root;
  if (lstatSync(root).isSymbolicLink())
    throw new Error("工程根目录不能是符号链接");
  for (const part of inside.split(sep)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error("生成目标不能经过符号链接");
  }
  return target;
}

/** 验证模块与全部登记位置后生成可审阅计划，预览阶段不写文件、不连接数据库且拒绝覆盖既有业务。 */
export function createGenerationPlan(root, input) {
  root = resolve(root);
  const config = validateModule(input);
  const { module, resource, entity, label, singular, table, fields } = config;
  const plan = new Map();
  const read = (name) =>
    plan.get(name)?.after ?? readFileSync(safeTarget(root, name), "utf8");
  const add = (name, after) => {
    const target = safeTarget(root, name);
    if (existsSync(target)) throw new Error(`拒绝覆盖已有文件：${name}`);
    plan.set(name, { name, before: null, after });
  };
  const patch = (name, marker, content) => {
    const before = read(name);
    const token = marker.trim();
    if (before.split(token).length !== 2)
      throw new Error(`${name} 注册标记缺失或重复`);
    // 格式化器可以改变缩进，登记标记的语义不受缩进影响。
    const markerLine = before
      .split(/\r?\n/)
      .find((line) => line.trim() === token);
    if (!markerLine) throw new Error(`${name} 注册标记必须独占一行`);
    plan.set(name, {
      name,
      before: plan.get(name)?.before ?? before,
      after: before.replace(markerLine, `${content}\n${markerLine}`),
    });
  };
  if (
    read(
      "backend/mayday-security/src/main/java/com/mayday/security/PermissionCatalog.java",
    ).includes(`"${resource}"`) ||
    read("backend/pom.xml").includes(`<module>mayday-${module}</module>`) ||
    read("database/mayday.sql").includes(`CREATE TABLE \`${table}\``)
  )
    throw new Error("模块、权限资源或数据库表已存在");
  // Springdoc 的模型名称默认不含 Java 包名，跨模块 DTO 重名也必须在生成前拒绝。
  const declarations = new RegExp(
    `\\b(?:class|interface|record|enum)\\s+${entity}(?:View|Request|Contracts|Service|Controller|Repository)?\\b`,
  );
  for (const file of globSync("backend/**/src/main/java/**/*.java", {
    cwd: root,
  })) {
    if (declarations.test(readFileSync(safeTarget(root, file), "utf8")))
      throw new Error("实体或 DTO 名称已被其他模块使用");
  }
  const javaType = (field) =>
    ({ string: "String", integer: "Integer", boolean: "Boolean" })[field.type];
  const getter = (field) => `get${capitalize(field.name)}`;
  const values = {
    ...config,
    viewRequiredProperties: [
      "id",
      ...fields.map((field) => field.name),
      "ownerId",
      "departmentId",
      "createdAt",
      "updatedAt",
      "version",
    ]
      .map((name) => `"${name}"`)
      .join(", "),
    inputNumberImport: fields.some((field) => field.type === "integer")
      ? ", InputNumber"
      : "",
    entityFields: fields
      .map(
        (field) =>
          `  /** ${field.label}；${field.type === "string" ? `最大 ${field.maxLength} 个字符` : "不接受空值"}。 */\n  @Column(${field.required ? "nullable = false, " : ""}${field.type === "string" ? `length = ${field.maxLength}` : `name = "${snakeCase(field.name)}"`})\n  private ${javaType(field)} ${field.name};`,
      )
      .join("\n\n"),
    requestFields: fields
      .map(
        (field) =>
          `      ${field.required ? (field.type === "string" ? "@NotBlank " : "@NotNull ") : "@Schema(nullable = true) "}${field.type === "string" ? `@Size(max = ${field.maxLength}) ` : ""}${javaType(field)} ${field.name}`,
      )
      .join(",\n"),
    viewFields: fields
      .map(
        (field) =>
          `      ${field.required ? "" : "@Schema(nullable = true) "}${javaType(field)} ${field.name}`,
      )
      .join(",\n"),
    viewValues: fields
      .map((field) => `          entity.${getter(field)}()`)
      .join(",\n"),
    assignments: fields
      .map(
        (field) =>
          `    entity.set${capitalize(field.name)}(${field.type === "string" ? `Objects.toString(request.${field.name}(), "").trim()` : `request.${field.name}()`});`,
      )
      .join("\n"),
    frontendDefaults: fields
      .map(
        (field) =>
          `${field.name}: ${field.type === "string" ? '""' : field.type === "integer" ? "0" : "true"}`,
      )
      .join(", "),
    frontendPayload: fields
      .map(
        (field) =>
          `            ${field.name}: ${field.type === "string" ? `String(values.${field.name} ?? "").trim()` : field.type === "integer" ? `Number(values.${field.name})` : `Boolean(values.${field.name})`}`,
      )
      .join(",\n"),
    frontendColumns: fields
      .filter((field) => field.name !== "enabled")
      .map(
        (field) =>
          `        { title: "${field.label}", dataIndex: "${field.name}", ellipsis: true${field.name === "title" ? ", width: 240" : ""} }`,
      )
      .join(",\n"),
    frontendFields: fields
      .filter((field) => field.name !== "enabled")
      .map(
        (field) =>
          `        <Form.Item name="${field.name}" label="${field.label}" rules={[{ required: ${field.required}${field.type === "string" ? `, whitespace: true, max: ${field.maxLength}` : ""} }]} >${field.type === "integer" ? "<InputNumber precision={0} />" : field.maxLength > 300 ? `<Input.TextArea rows={3} maxLength={${field.maxLength}} showCount />` : `<Input maxLength={${field.maxLength}} />`}</Form.Item>`,
      )
      .join("\n"),
    testValues: fields
      .map((field) =>
        field.type === "string"
          ? '"测试"'
          : field.type === "integer"
            ? "1"
            : "true",
      )
      .join(", "),
  };
  const render = (name) =>
    readFileSync(join(templateRoot, name), "utf8").replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => {
        if (!(key in values)) throw new Error(`模板变量不存在：${key}`);
        return values[key];
      },
    );
  const source = `backend/mayday-${module}/src/main/java/com/mayday/${module}`;
  add(`backend/mayday-${module}/pom.xml`, render("module-pom.xml.tpl"));
  for (const [template, suffix] of [
    ["entity", ""],
    ["contracts", "Contracts"],
    ["repository", "Repository"],
    ["service", "Service"],
    ["controller", "Controller"],
  ])
    add(`${source}/${entity}${suffix}.java`, render(`${template}.java.tpl`));
  add(
    `backend/mayday-${module}/src/test/java/com/mayday/${module}/${entity}ServiceTest.java`,
    render("service-test.java.tpl"),
  );
  add(`frontend/src/pages/business/${entity}Page.tsx`, render("page.tsx.tpl"));
  patch(
    "backend/pom.xml",
    "    <!-- generator:maven-modules -->",
    `    <module>mayday-${module}</module>`,
  );
  patch(
    "backend/mayday-application/pom.xml",
    "    <!-- generator:maven-dependencies -->",
    `    <dependency>\n      <groupId>com.mayday</groupId>\n      <artifactId>mayday-${module}</artifactId>\n      <version>\${project.version}</version>\n    </dependency>`,
  );
  patch(
    "backend/mayday-security/src/main/java/com/mayday/security/PermissionCatalog.java",
    "          // generator:permission-groups",
    `          new Group("${resource}", "${label}", actions(), true),`,
  );
  patch(
    "backend/mayday-application/src/main/java/com/mayday/service/NavigationCatalog.java",
    "          // generator:navigation-pages",
    `          page("${resource}", "${label}", "/admin/${resource}"),`,
  );
  const switches =
    "backend/mayday-common/src/main/java/com/mayday/common/ModuleSwitches.java";
  patch(switches, "      // generator:module-keys", `      , "${module}"`);
  patch(
    switches,
    "      // generator:module-defaults",
    `      case "${module}" -> false;`,
  );
  patch(
    switches,
    "      // generator:permission-modules",
    `      case "${resource}" -> "${module}";`,
  );
  patch(
    switches,
    "        // generator:api-modules",
    `        , Map.entry("/api/business/${resource}/**", "${module}")`,
  );
  const variable = `MODULE_${module.toUpperCase()}_ENABLED`;
  patch(
    "backend/mayday-application/src/main/resources/application.yml",
    "      # generator:module-environment",
    `      ${module}: \${${variable}:false}`,
  );
  for (const name of ["compose.yaml", "compose.verify.yaml"])
    patch(
      name,
      "      # generator:compose-environment",
      name === "compose.verify.yaml"
        ? `      ${variable}: "true"`
        : `      ${variable}: \${${variable}:-false}`,
    );
  patch(
    ".env.example",
    "# generator:env-example",
    `# ${label}示例；按业务需要启用并授权，默认不展示。\n${variable}=false`,
  );
  patch(
    "frontend/src/lib/workspace-model.ts",
    "  // generator:frontend-pages",
    `  { path: "/admin/${resource}", title: "${label}", permission: "${resource}:view", screen: "${module}", group: "独立入口", icon: "notices" },`,
  );
  patch(
    "frontend/src/App.tsx",
    "// generator:frontend-imports",
    `const ${entity}Page = lazy(() => import("./pages/business/${entity}Page").then(module => ({ default: module.${entity}Page })));`,
  );
  patch(
    "frontend/src/App.tsx",
    "                // generator:frontend-screens",
    `                ${module}: ${entity}Page,`,
  );
  patch(
    "frontend/src/lib/module-model.ts",
    "  // generator:frontend-modules",
    `  "/admin/${resource}": "${module}",`,
  );
  const migrations = read("database/mayday.sql");
  const baseline = /VALUES \(1, '(\d+)', '<< Flyway Baseline >>'/.exec(
    migrations,
  );
  if (!baseline) throw new Error("统一 SQL 基线标记不存在");
  const version = Number(baseline[1]) + 1;
  if (version < 2 || version > 10000) throw new Error("基线版本不合法");
  const columns = fields.map(
    (field) =>
      `  \`${snakeCase(field.name)}\` ${field.type === "string" ? `varchar(${field.maxLength})` : field.type === "integer" ? "int" : "tinyint(1)"} ${field.required ? "NOT NULL" : "DEFAULT NULL"} COMMENT '${field.label}；${field.type === "string" ? `最大 ${field.maxLength} 个字符` : field.type === "boolean" ? "1 启用，0 停用" : "整型业务数值"}',`,
  );
  const schema = `-- ${label}独立模块；创建者与部门在服务端确定，所有读写遵守动作权限和行级范围。\nCREATE TABLE \`${table}\` (\n  \`id\` bigint NOT NULL AUTO_INCREMENT COMMENT '记录主键；数据库自增，不接受客户端指定',\n${columns.join("\n")}\n  \`owner_id\` bigint NOT NULL COMMENT '创建账号主键；服务器从有效登录身份赋值，普通编辑不可修改',\n  \`department_id\` bigint DEFAULT NULL COMMENT '创建时部门主键；用于部门及指定部门数据范围判断',\n  \`created_at\` datetime(6) NOT NULL COMMENT '创建时间；服务端生成，Asia/Shanghai',\n  \`updated_at\` datetime(6) NOT NULL COMMENT '最近修改时间；服务端在事务提交时维护',\n  \`version\` bigint NOT NULL DEFAULT '0' COMMENT '乐观锁版本；编辑和删除必须提交当前值，否则返回 409',\n  PRIMARY KEY (\`id\`),\n  KEY \`idx_${table}_owner\` (\`owner_id\`),\n  KEY \`idx_${table}_department\` (\`department_id\`),\n  CONSTRAINT \`fk_${table}_owner\` FOREIGN KEY (\`owner_id\`) REFERENCES \`sys_user\` (\`id\`),\n  CONSTRAINT \`fk_${table}_department\` FOREIGN KEY (\`department_id\`) REFERENCES \`sys_entry\` (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='${label}业务记录；模块关闭时保留数据';\n`;
  const menu = `-- 只补建导航，不自动授予普通角色权限，不修改已有菜单或业务记录。\nINSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)\nSELECT 'menus','${label}','${resource}','/admin/${resource}','${resource}:view',200,1,NOW(6),NOW(6),0\nWHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='menus' AND code='${resource}');\n`;
  add(
    `backend/mayday-application/src/main/resources/db/migration/V${version}__${module}.sql`,
    `${schema}\n${menu}`,
  );
  // 保持唯一公开 SQL 可用于首次安装；内部 Flyway 脚本用于已有库增量升级，历史文件不改。
  const columnCount = fields.length + 6;
  let updated = migrations
    .replace(
      "SET SESSION foreign_key_checks = @mayday_original_foreign_key_checks;",
      `${schema}\nSET SESSION foreign_key_checks = @mayday_original_foreign_key_checks;`,
    )
    .replace(/V\d+/g, (old) =>
      old === `V${baseline[1]}`
        ? `V${version}`
        : old === `V${version}`
          ? `V${version + 1}`
          : old,
    )
    .replace(/(\d+) 张业务表/g, (_, count) => `${Number(count) + 1} 张业务表`)
    .replace(
      /(\d+) 个业务字段/g,
      (_, count) => `${Number(count) + columnCount} 个业务字段`,
    )
    .replace(
      "-- BASELINE 不伪造 V1–V15 的执行校验和；它声明当前结构已处于版本 15。",
      `-- BASELINE 声明当前结构已处于版本 ${version}；不伪造历史迁移的执行校验和。`,
    )
    .replace(
      /BASELINE 声明当前结构已处于版本 \d+/g,
      `BASELINE 声明当前结构已处于版本 ${version}`,
    )
    .replace(/本初始化基线为 \d+/g, `本初始化基线为 ${version}`)
    .replace(
      `VALUES (1, '${baseline[1]}',`,
      `${menu}\nVALUES (1, '${version}',`,
    );
  // 菜单插入不能插在 flyway INSERT 的列清单与 VALUES 中间。
  updated = updated
    .replace(
      `  (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)\n${menu}\nVALUES`,
      `  (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)\nVALUES`,
    )
    .replace(
      "-- 全部建表及基础资料成功后才登记基线",
      `${menu}\n-- 全部建表及基础资料成功后才登记基线`,
    );
  plan.set("database/mayday.sql", {
    name: "database/mayday.sql",
    before: migrations,
    after: updated,
  });
  return [...plan.values()];
}

/** 二次核对计划基线后写入，任何失败只回滚本次文件变更；调用方仍须格式化、契约生成与数据库验收。 */
export function applyGenerationPlan(root, plan) {
  const applied = [];
  // 二次检查防止预览后被其他编辑修改，也避免半套注册产生无法启动的工程。
  for (const item of plan) {
    const target = safeTarget(resolve(root), item.name);
    if (
      (existsSync(target) ? readFileSync(target, "utf8") : null) !== item.before
    )
      throw new Error(`生成计划已过期：${item.name}`);
  }
  try {
    for (const item of plan) {
      const target = safeTarget(resolve(root), item.name);
      mkdirSync(dirname(target), { recursive: true });
      applied.push(item);
      writeFileSync(target, item.after, "utf8");
    }
  } catch (error) {
    for (const item of applied.reverse()) {
      const target = safeTarget(resolve(root), item.name);
      if (item.before === null) {
        if (existsSync(target)) unlinkSync(target);
      } else writeFileSync(target, item.before, "utf8");
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--config");
  if (
    index < 0 ||
    !args[index + 1] ||
    args.some(
      (arg, position) =>
        !["--config", "--apply"].includes(arg) && position !== index + 1,
    )
  )
    throw new Error(
      "用法：node scripts/generate-module.mjs --config <配置.json> [--apply]",
    );
  const config = JSON.parse(readFileSync(resolve(args[index + 1]), "utf8"));
  const plan = createGenerationPlan(repositoryRoot, config);
  for (const item of plan)
    console.log(`${item.before === null ? "新增" : "更新"}：${item.name}`);
  if (args.includes("--apply")) {
    applyGenerationPlan(repositoryRoot, plan);
    console.log(
      "模块已生成。请格式化、生成接口类型并验证，再启动已有数据库的增量升级。",
    );
  } else console.log("仅预览，未写入文件。添加 --apply 执行生成。");
}
