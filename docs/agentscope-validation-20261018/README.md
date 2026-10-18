# AgentScope 独立模块验收记录

验收日期：2026-10-18。记录范围仅包含本次 AgentScope Java 独立模块；不能代替 Mayday 其他功能的完整产品验收，也没有使用日常数据库。

## 已通过

- Maven 模块 `mayday-agentscope` 已加入聚合构建，应用按 `MODULE_AGENTSCOPE_ENABLED` 控制启用；验收镜像成功完成全量 `mvn package`、Spotless 格式检查和测试。
- React/TypeScript 前端生产构建通过；模块开关契约、类型检查与 OpenAPI 契约检查通过。隔离后端真实生成并核对 175 个 OpenAPI 路径及对应 TypeScript 类型。
- 在单独 Compose 项目 `mayday-agentscope-20261018` 中启动新的 MySQL 空库和隔离后端。Flyway V32 成功，Spring Boot 完成健康检查，JPA 校验新表结构；数据库中三张 AgentScope 表及中文表/字段注释均存在。验收只使用项目独有卷 `mayday-agentscope-20261018_fresh_data`，没有启动或连接日常数据库。
- 将唯一安装脚本 `database/mayday.sql` 导入另一独立空库并启动后端成功；实查为 67 张业务表、624 个字段，缺失表注释和字段注释均为 0。初始化库上的同一组 AgentScope 真实接口冒烟也通过，验证 Flyway V32 基线与安装脚本路径一致。
- 真实 HTTP 冒烟检查覆盖未登录拒绝（401）、开关及模型状态、创建私有会话、按用户分页列表、空历史读取、缺少模型密钥时安全返回 503、删除会话及删除后的 404。验收管理员正常登出。
- AgentScope 协调器测试通过 3 项：重试接管产生不同租约令牌、旧回复不能完成新请求、旧失败不能标记或释放新租约。
- 统一安装脚本 `database/mayday.sql` 已同步 V32，文档说明模块独立开关、权限、密钥、表结构、隐私边界、运行限制和复用方式。

## 未覆盖的能力边界

- 未配置有效 DashScope 密钥，因此没有向外部模型发起真实请求；真实模型回复、供应商限流和计费策略需在部署方提供受控密钥后验证。
- 本记录未重跑 Mayday 全量升级库/空库业务基线、日常库迁移、双实例 AgentScope 压力测试或完整管理员浏览器交互闭环。不能把模块冒烟测试等同于整个项目的最终验收。
- 多模型路由、流式响应、工具审批、知识库/RAG、用量统计和调用审计 UI 不在此模块当前交付范围，详见[模块说明](../agentscope.md)。

## 可复核命令与证据

- Maven 全量构建在隔离后端镜像构建阶段完成，Docker 目标为 `mayday-verification-backend:local`。
- 前端生产构建：`cd frontend && npm run build`。
- 模块开关契约：`node scripts/module-switch-contract.mjs` 与 `node --test tests/module-model.test.mjs`。
- OpenAPI：`node scripts/generate-api.mjs --check --offline`。
- V32 迁移结果：隔离库的 `flyway_schema_history` 中版本 `32` 状态为成功。

隔离 Compose 项目保持与默认 `mayday` 项目分离；如需清理，只对项目名 `mayday-agentscope-20261018` 执行 Compose down，并删除该项目创建的独有卷。不要使用默认 Compose 项目或默认 MySQL 卷代替本记录环境。

## 后续配置界面验收（2026-10-18）

- 模型设置已从系统管理的导航菜单移入智能体页面，拥有 `agentscope:configure` 的操作者可在智能体页打开弹窗；配置 API 仍由相同服务端权限保护，旧 `/admin/agentscope-settings` 仅保留为书签兼容路由。V34 升级会隐藏旧菜单，统一初始化 SQL 也不再创建该菜单。
- 模型使用可搜索的百炼常用项，并允许手动输入模型 ID。选项按百炼官方模型文档配置，覆盖 Qwen、DeepSeek、GLM、Kimi、MiniMax；百炼账户/地域的具体开通情况仍以服务控制台为准。参考：[百炼文本生成模型](https://help.aliyun.com/zh/model-studio/text-generation-model)、[百炼模型服务概览](https://help.aliyun.com/zh/model-studio/what-is-model-studio)。
- 前端生产构建成功。隔离预览实例成功执行 Flyway V34 并通过健康检查；真实浏览器确认智能体页出现“模型设置”、系统管理不再显示旧入口、下拉列表可搜索常用模型、模型输入框保留自定义模型 ID 能力。未填写真实供应商密钥，没有发起计费请求。
- Maven 全模块构建成功，128 项测试通过、12 项环境型测试按既定条件跳过。单文件 SQL 注释静态测试通过；数据库元数据的 live `--check` 本轮未运行成功，因为默认本机 MySQL 未连接，未对其启动或作修改。本次 V34 不改业务表结构，只更改旧菜单可见性。
