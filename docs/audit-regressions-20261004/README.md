# 原审查问题回归（2026-10-04）

基线为 `1c6a7539be98cce7e656325d578a28665dfbd7fc`。旧基线的未提交草稿保留在另一工作树，本次没有覆盖主线新增的门户、OA、文件、SSE、会话分页及生产检查；没有修改 V1–V22 历史迁移。

## 对照及改动

- F10：系统参数表单未注册 sortOrder，合法新增仍缺少后端必需字段。注册隐藏字段，新增提交默认 0，编辑保留原排序和 version。新增实际组件表单提交回归，不以手工完整 JSON 替代 UI 契约验证。
- F02：保留框架客户端异常的 HTTP 状态与 Allow/Accept 头；multipart 解析错误返回 400；原有 404、413、业务与授权边界保持。上传入口显式限定 multipart，并通过运行中实例重新生成 OpenAPI 和 TypeScript 类型。未知异常仍返回脱敏 500。
- F03：原报告定位的是 operations/JobRunner、DATABASE_CHECK，**不是采集调度器**。主线已实现业务回滚后的独立失败事务与计划推进，未重写该实现。新增真实 MySQL 测试：业务写入回滚、失败记录跨调用方回滚保留、到期时间前进、下次轮询不重复、成功路径两个并发领取者仅执行一次。失败回滚与补记之间的多节点重领窗口仍按现有注释保留，处理器仍须幂等；数据库整体不可用时不能保证历史持久化。
- 已复用主线的 CI、SQL 会话分页，没有重复重构。现有 verify-crawler 临时 MySQL 脚本追加调度事务测试，并接入 CI，避免新增集成测试长期仅跳过。

## 本地验证

隔离原生 MySQL 8.4.7，仅监听 127.0.0.1:23306；测试库从 V17 升级至 V22。HTTP 服务与浏览器只访问回环实例，未连接生产库或外部 UDP 目标。文件存储使用独立测试目录，临时文件经过回收及永久删除。

| 命令/操作 | 结果 |
|---|---|
| `npm ci --prefix frontend`（使用独立可写缓存） | 成功 |
| `node scripts/check-project.mjs` | 源码约定、格式、离线契约、37 项模型/工具测试、前端类型检查与构建通过；UI 164 项中 162 通过、2 项 Java 桥接用例因缺少桥接环境跳过 |
| `bash backend/mvnw -f backend/pom.xml verify`（显式回环专用 CRAWLER_TEST_DB_URL/PASSWORD） | 122 项中 121 通过，1 项真实 S3 桶用例因未配置端点跳过；包括采集 11 项与调度真实事务 2 项；Spotless 及打包通过 |
| `node scripts/generate-api.mjs`、`--check` | 从隔离完整功能实例生成并复核 145 个路径；唯一契约变化为文件上传 JSON → multipart |
| `npm run build --prefix frontend` | 生成契约后的类型检查及生产构建通过 |
| Chromium 实际操作 | 验证码登录 → 参数新增 sortOrder=0 → 编辑值/保留版本 → 删除，通过 |
| 真实 HTTP 错误与文件流程 | 缺文件 400、JSON 上传 415、错误方法 405 且保留 Allow、坏 multipart 400、不存在路径 404；合法上传/下载内容一致、回收/永久清理通过 |

新增 MVC 用例还验证大小限制 413、缺参数 400，以及内部错误 500 不泄露详情。浏览器初次脚本因表头和输入框同名产生定位歧义，限定弹窗后实际操作通过；不是产品表单失败。

## 复现与边界

无需数据库的前端测试使用 `npm run test:ui --prefix frontend`；后端 `verify` 默认跳过外部环境门控的集成项。推荐 `node scripts/verify-crawler.mjs` 创建随机密码、随机回环端口的官方 MySQL 8.4 容器，导入当前统一 SQL 并运行采集及调度事务回归，最终清理其自建容器。它已加入 Framework quality；完整升级/权限/模块/在线契约继续由现有 verify-baseline 执行。

手动运行集成用例必须指定 `CRAWLER_TEST_DB_URL=jdbc:mysql://127.0.0.1:<端口>/mayday_crawler_test?...`，账号为 mayday_test，密码通过 CRAWLER_TEST_DB_PASSWORD 环境变量提供。仅允许专用隔离库，禁止复用日常数据；不要把凭据提交到仓库。

本轮未重新穷尽全站 UI、真实设备、多网卡、长期负载、真实 S3 或多浏览器验收。没有新增公网入口、部署、合并主线或强推。CI 以本分支对应提交的 Framework quality 结果为准；本地原生 MySQL 结果不冒充 Docker 脚本执行结果。
