# 二次开发与工程规范

本框架使用 Java 21、Spring Boot 4、MySQL 8.4、React、TypeScript 和 Ant Design。账号、角色、数据范围、审计、文件、分页列表及弹窗是共用基础。UDP 是独立测试模块，本轮没有扩展转发业务。

本次交付的测试范围和结果见 [工程底座验收](engineering-validation-20261002/README.md)。

## 新增业务模块

用 JSON 声明模块、实体、权限资源、表名和字段。可复制 `tools/generator/examples/workorder.json`，使用新的名称。当前支持字符串、整数、布尔字段；标准列表保留必填 `title` 与 `enabled`。金额、关联、多租户、复杂状态机需要另行设计业务规则，不能直接套用普通 CRUD。

先预览，审查文件清单后执行：

```text
node scripts/generate-module.mjs --config tools/generator/examples/your-module.json
node scripts/generate-module.mjs --config tools/generator/examples/your-module.json --apply
```

生成器一次生成独立 Maven 模块、实体、请求/响应 DTO、查询仓库、服务、控制器、前端页面及安全测试，同时登记权限、菜单、开关、路由和新版本迁移。它同步唯一公开数据库脚本 `database/mayday.sql`，不改历史迁移，不运行 SQL，不覆盖已存在的模块。配置、路径、字段、登记标记和文件冲突先检查，预览之后发生文件修改也会拒绝执行。

生成后按照以下顺序完成交付：

1. 审查字段和注释，添加真实业务校验。后端服务是授权边界，不能只在按钮或控制器中校验。
2. 运行后端格式化。Windows 使用 `backend/mvnw.cmd`，其他系统使用 `bash backend/mvnw`：`-f backend/pom.xml -pl '!mayday-netty' spotless:apply`。
3. 运行 `npm run format --prefix frontend`，再执行后端 `verify`。UDP 独立模块保持自身构建配置。
4. 在独立数据库开启新模块、执行迁移，运行 `node scripts/generate-api.mjs` 同步接口契约与前端类型。
5. 执行前端检查和真实数据库的权限/版本/升级测试，确认测试记录完整清理。
6. 已有业务库只通过新 Flyway 迁移升级，不重新导入统一初始化 SQL。

已生成的工单示例位于 `backend/mayday-workorders` 与 `frontend/src/pages/business/WorkOrderPage.tsx`，默认关闭。需要使用时配置 `MODULE_WORKORDERS_ENABLED=true` 后重启，再授予 `workorders:view/create/update/delete` 及数据范围。不为普通角色自动扩权。所有查询在 SQL 层增加范围条件，直接读取、编辑和删除也检查范围；创建人、部门和时间均由服务端赋值。编辑及删除携带版本号，冲突返回 409。

## 模块裁剪

配置 `.env` 中的 `MODULE_*_ENABLED` 并重启后端。Java 的 `ModuleSwitches` 是有效状态的唯一来源，前端通过 `/api/platform/features` 获取状态。核心账号、组织、角色、审计与文件模块保留，保障身份和共享服务正常工作。

- `CONTENT`：内容、分类、标签、回收站。
- `PORTAL`：公开门户和网站配置，依赖内容模块。
- `NOTIFICATIONS`：通知、收件箱、未读数及通知附件。
- `APPROVALS`：流程、审批分类、申请、待办及审批附件，依赖消息模块。
- `CRAWLER`：采集配置、数据、图片下载及采集轮询。
- `SCHEDULER`：调度配置、执行记录及自动调度。
- `UDP`：已有测试功能。
- `WORKORDERS`：可运行的生成器示例，默认关闭。

关闭依赖时自动关闭消费模块，例如内容关闭则门户关闭，消息关闭则审批关闭。无效模块名称会拒绝启动，避免拼写错误导致功能仍然开启。关闭模块后：

- 接口及附件直接访问返回 404，管理员也不能绕过。
- 菜单、页面搜索、恢复页签和直接路由受有效状态限制。
- 会话权限及授予候选不再包含该模块，已保存的角色授权仍保留。
- 采集、审批消息投递和调度轮询暂停，重新开启后按原持久记录继续。
- 表、迁移、原业务数据不会删除；这是运行功能裁剪，不是物理删除代码或表。

模块开关不是租户权限，也不是线上热配置。修改后应重启，并在业务维护窗口核对运行中任务。外部集成和新后台任务必须复用相同开关与授权策略。

## 接口契约

`/api/platform/openapi` 从控制器、参数和 DTO 生成 OpenAPI，仅超级管理员可读取；生产环境可用 `API_DOCS_ENABLED=false` 关闭。接口标识固定为控制器名和方法名，禁止依赖反射发现顺序生成易变名称。关闭模块的接口会从当前实例契约中剔除。

`contracts/openapi.json` 是完整功能实例导出的结构契约，`frontend/src/types/generated/api.ts` 是生成类型。禁止手改生成类型；先改 Java DTO，再运行：

```text
node scripts/generate-api.mjs
node scripts/generate-api.mjs --check
node scripts/generate-api.mjs --offline --check
```

导出实例应开启需要登记的功能，包括工单示例。`API_BASE` 指向该实例的 `/api`，管理员密码从环境变量或忽略的 `.env` 读取，不通过命令行传递。脚本完成后撤销临时登录会话。离线检查验证已提交的契约和类型一致；在线检查还比较真实控制器。前端 `contract-client.ts` 共用会话、超时、错误处理和解包逻辑，新页面使用生成的路径、请求体和响应类型，避免手写重复接口类型。

已有模块中仍有历史 `ApiResponse<?>`、动态 Map 和通用资料接口，其响应类型只能表达通用结构，不能推断每个业务字段。新增模块必须采用明确 DTO 和 `ApiResponse<具体类型>`；本次把登录、会话及用户读写收紧为明确响应。实际授权始终由后端执行，OpenAPI 的类型检查不能代替业务校验。

## 命名、格式和注释

Java 类使用 PascalCase，方法和字段使用 camelCase，常量使用 UPPER_SNAKE_CASE；数据库表/列使用 lower_snake_case；新业务表使用 `biz_` 前缀。前端组件使用 PascalCase，普通函数和变量使用 camelCase。权限统一 `resource:action`，动作不得复用来绕过独立授权。

`.editorconfig` 统一 UTF-8、LF 和两空格缩进。Java 由 Spotless 和 Google Java Format 格式化，在 Maven `validate` 阶段检查；前端使用 Prettier。新增代码优先显式导入，禁用 `any` 绕过类型；请求 DTO 不直接使用 JPA 实体。组件优先复用 `ResourcePage`、`FormModal`、选择器和统一网络边界。

类和公开业务边界说明职责；注释解释权限、字段来源、状态变化、事务、并发、失败语义及设计原因，不能只复述代码。数据库每张业务表和每个字段必须写中文 COMMENT，说明含义、来源、单位/枚举、空值和重要约束。迁移文件不可重写历史校验和。

## 持续集成

GitHub Actions 的 `Framework quality` 执行：格式、生成器安全测试、前端模型和交互测试、TypeScript 检查、生产构建、Java 测试与打包、真实 MySQL 空库与保留数据升级、权限回归、模块开关及接口契约比较。测试失败会阻止该检查通过。

本地前端统一入口为 `node scripts/check-project.mjs`；数据库综合验收为 `node scripts/verify-baseline.mjs`。首次有意更新契约时可加 `--update-contract`，普通验收和 CI 始终比较而不修改。验收生成随机项目、数据库、凭证和本地备份，不向日常库写测试数据；成功或失败均清理本次临时环境。`--keep-for-preview` 仅为人工页面验收保留成功环境。

仓库提供 CI 检查，但 GitHub 分支保护需由仓库管理员在设置中把该检查设为必需项。后续新业务仍要补自己的边界用例，不能因为框架测试通过就保证任意扩展业务不存在漏洞。
