# AgentScope 独立智能体模块

Mayday 通过独立 Maven 模块 `backend/mayday-agentscope` 接入 AgentScope Java。当前锁定 AgentScope Java **2.0.4** 最新稳定版；官方 2.1.0-BETA1 仍是预发布版本，因此不作为可复用底座的默认生产依赖。核心、Harness、DashScope 模型扩展及 JDBC 扩展使用同一版本，避免二进制接口错配。

## 启用与配置

模块开关仍由部署人员控制：设置 `MODULE_AGENTSCOPE_ENABLED=true` 并重启应用。模型和密钥直接在“智能体”页面右上角的“模型设置”弹窗维护；拥有 `agentscope:configure` 权限的人员可以更换模型、更新密钥、调整请求限制和系统提示词。配置保存后立即应用，不需要重启。旧的 `/admin/agentscope-settings` 地址保留以兼容书签，但不再出现在系统管理菜单。

API 密钥以 AES-256-GCM 密文保存于专用 `sys_agentscope_config` 表，读取接口仅返回是否已配置；后台普通“系统参数”不保存任何密钥。加密使用稳定的 `MAYDAY_IDENTITY_ENCRYPTION_KEY`，所有应用实例必须设置相同值并与数据库备份一起保管。若没有这个部署密钥，后台会拒绝保存新的模型密钥。可选的 `DASHSCOPE_API_KEY` 仅作为部署默认值/回退值，不是日常配置入口。密钥不会进入页面回包、操作日志或明文数据库列。

当前连接使用已打包的百炼 DashScope 提供方。模型字段使用可搜索的常用选项，同时允许手动输入符合 `dashscope:<模型ID>` 格式的模型名；选项包含百炼官方模型目录中的 Qwen、DeepSeek、GLM、Kimi 和 MiniMax 常见模型。百炼的模型开放情况会按账号和地域变化，选择列表不替代百炼控制台中的实际开通状态。页面不接受任意 API 地址；添加独立模型服务商仍需接入对应 AgentScope 官方模型扩展。已有角色不会自动获得 `agentscope:*` 权限，需由有角色授权权限的管理员显式分配。

## 已实现能力

- 管理员配置模型和密钥无需修改普通系统参数；配置接口使用独立 `agentscope:configure` 权限，运行时在保存后原子切换。
- 模块启停仍由部署开关控制；只有拥有 `agentscope:configure` 的人员会在智能体页看到模型设置入口，配置 API 仍由后端独立鉴权。模块关闭时聊天菜单、接口和会话权限均不可用。
- 会话、消息列表和消息历史均按认证用户隔离。API 不接收 ownerId、AgentScope sessionId、模型名或角色列表；猜测其他用户的会话编号得到 404。
- 新建、分页、删除会话；消息分页查看；单次消息有服务端长度限制和 UUID 幂等键。失败消息可用相同幂等键重试。
- 同一会话在多个应用实例上使用数据库租约串行处理。租约过期后由后续请求接管，旧请求完成时必须通过 fencing token 检查，迟到回复会被丢弃。
- 对话记录是 UI 和上下文恢复的权威来源。每次调用前清除 AgentScope 运行上下文，使用数据库中最近成功的完整对话重建后再发起请求；处理失败不会把半轮内容带进后续上下文。
- AgentScope 官方 JDBC 状态扩展使用项目 MySQL DataSource，并关闭 SDK 自动建表。V32 创建带中文字段注释的状态表；V33 增加独立配置表，官方状态行与 Mayday 会话目录在重启和多实例间持久保留。
- 用户消息作为纯文本呈现。AgentScope 没有网页、命令行、文件、MCP、动态技能、子智能体或记忆工具，不能直接读取平台用户、审批、内容和文件数据。
- 删除会话会清除对应 AgentScope 状态；删除账号时清除该账号所有 AgentScope 状态与会话记录。
- 会话权限为 `agentscope:view`、`agentscope:create`、`agentscope:chat` 和 `agentscope:delete`；模型运维权限为独立的 `agentscope:configure`，角色授权目录不提供无关的 edit/export 权限。

## 数据结构

V32 新增三张表：

| 表 | 用途 |
| --- | --- |
| `ai_agent_conversation` | 会话所有者、展示标题、随机 session ID、处理租约 |
| `ai_agent_message` | 纯文本用户/助手消息、完成状态和幂等标识 |
| `ai_agent_state` | AgentScope 官方 JDBC 扩展的 session state |

会话所有者和消息归属有级联外键；AgentScope 官方状态表由扩展按 `(session_id, state_key, item_index)` 管理，不擅自添加会破坏官方 SQL 的列或索引。用户删除先按官方状态 API 清除其 `userId/sessionId` 状态，再删除业务会话。数据库唯一交付脚本仍为 [database/mayday.sql](../database/mayday.sql)；V32 增量迁移不可改写历史版本。

## 调用与隐私边界

模型请求通过服务端固定的 DashScope Provider 和后台已授权配置的模型名发出；普通使用者只能选择会话和输入纯文本，拥有 `agentscope:configure` 权限的人员可在智能体页切换共享模型，任何客户端都不能指定 API endpoint。消息正文会发送至配置的外部模型服务，因此操作界面明确提示不要输入密码、密钥等敏感信息；部署前应按组织的模型数据处理要求配置合适的服务账号和保留策略。Mayday 不会把菜单、用户表、审批数据、内容或附件注入模型上下文。

同步接口最长等待默认 120 秒、可配置为 10–300 秒；页面按服务端返回的超时值额外等待 15 秒，避免可配置运行时超出浏览器请求时限。消息长度默认最多 4000 字符，上下文默认最多最近 40 条成功消息（20 轮）。实际模型服务超时或调用失败时，客户端收到脱敏的 503，不记录提示词、回复、Provider 请求头或异常正文。模块本身未做流式输出、多模型路由、用量计费、RAG、知识库、函数工具授权或 AgentScope Service 运维控制台；这些能力应各自经过产品和权限设计后再逐项扩展。

## 新系统复用

复制模块时，需同时复用 `mayday-common` 的统一异常/实体/分页、`mayday-security` 的登录授权、Spring Boot 4、Java 21 和 MySQL 8.4；更新 Maven 聚合依赖、模块开关、接口鉴权、菜单权限目录、Flyway 迁移与安装脚本。接入其他模型时新增对应官方 model extension 和受控 provider 配置，不允许前端提供任意 URL、密钥或 class name。

源码格式由 Spotless/Google Java Format 统一，类型、方法和安全边界均保留中文说明。验收时至少检查：缺少 Key、模块关闭、模块无权限、用户 A 访问用户 B 会话、重复 requestId、会话并发、失败重试、租约到期后的旧请求、消息分页、删除会话状态清理、删除用户状态清理以及 MySQL 重启后的上下文恢复。完整构建结果会补记在当前任务验收记录中。

本轮实现和实测边界记录在[AgentScope 模块验收（2026-10-18）](agentscope-validation-20261018/README.md)。模型服务的真实回复需要部署环境提供有效 DashScope 密钥；本地验收未配置该密钥，因此没有对外发起计费模型请求。
