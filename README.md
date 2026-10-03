# Mayday Admin

一套带独立前台门户的模块化后台管理系统。前端使用 React + Ant Design + TypeScript，后端使用 Java 21 + Spring Boot 4 + MySQL 8.4。

权限按**资源、操作、数据范围**分别定义，菜单与后端授权解耦。后台与前台拥有独立主题，前台采用内容型门户布局，支持桌面与手机。

## 已包含的能力

- 系统管理：用户、角色、部门负责人、岗位、菜单、字典类型/字典项、分组类型参数、网站配置、操作日志、登录日志和真实用户统计。
- 精细授权：资源操作、本人/部门/下级/自定义部门/全部数据范围；用户邮箱、电话独立读写；授权委托、导出与批量操作共用服务端边界。
- 通知中心：富文本、附件、按用户/角色/部门/全部接收人发布，收件人快照、撤回/过期、个人收件箱与未读数。
- 内容与门户：栏目与分类独立配置、指南/公告/更新时间轴/故事杂志四种页面、首页编排、蓝白及海军蓝暗夜模式；封面、富文本、附件、SEO、推荐/置顶、不可变修订、发布历史、定时上下线、回收站。门户只读取实际在线修订，栏目停用同时关闭正文、封面及附件。见 [客户门户与后台控制](docs/portal.md)、[最新客户使用验收](docs/portal-customer-validation-20261003/README.md)。
- 图文采集：采集数据与采集配置使用独立菜单和页面，删除配置保留已有图文。支持公开 HTML / JSON、正文阅读、图片分页和放大；列表与详情独立分页，支持下一页、页码链接集合、页码/偏移量模板和游标，持久队列、停止继续、去重、失败重试及文件中心入库。见 [配置说明](docs/image-crawler.md)。
- UDP 转发：独立 Netty 4.1.105.Final 模块，可配置接收/单个目标 IP 与端口，替换第 3–4 字节为 `03 01`，实时显示包数、失败与丢弃、待发送和 Mbps。模块可脱离 Spring/MySQL 单独复用。见 [使用及验收](docs/udp-relay.md)。
- 审批中心：分类、不可变发布版本、申请草稿/待办/已办/抄送、指定人员/角色/部门负责人、会签/或签/顺签、条件分支、转交/加签、退回申请人或已办节点、修改重提、多轮历史、撤回/驳回/管理员终止、内容修订审核和可靠站内通知。
- 流程设计器：独立标签页、13 类真实表单控件（含日期区间与明细表）、节点字段权限矩阵、连接图/键盘节点列表、预览模拟、模型校验和未保存提醒。操作和扩展边界见 [OA 流程指南](docs/oa-workflow.md)，测试结果及待完成项见 [OA 验收记录](docs/oa-validation-20261002/README.md)。
- 公共框架：单侧分组菜单、多页签、共享查询表格/列配置/密度、居中操作弹窗、异步选择器、富文本和附件组件、版本冲突与统一错误处理。
- 查询与编辑：列表支持命名常用查询（每页最多 8 条）、列显隐/密度/每页条数记忆；偏好按账号与页面保存在当前浏览器。操作弹窗、个人资料、流程设计统一提供切换菜单、关闭页签、刷新和退出时的未保存保护。见 [后台使用与检查记录](docs/admin-usability-validation-20260922/README.md)。
- 主题定制：右侧抽屉提供图示主题预设、浅色/深色/跟随系统、独立导航配色、背景、边框/阴影、圆角、密度、内容宽度、图表色板和状态色，支持即时预览、复制/导入与恢复默认。后台右上角“后台主题”保存本浏览器偏好，取消恢复原样；“网站配置 → 前台主题”独立预览，单独保存全站门户配置到数据库。详见 [主题配置](docs/themes.md)。
- 登录验证：输入账号密码后弹出滑动拼图，通过后继续登录；后端验证账号/来源绑定、有效期及一次性凭证，保留密码失败限流。支持触屏拖动和方向键/回车操作。
- 工程底座：业务模块生成器与默认关闭的工单示例、项目模块开关、真实 OpenAPI 契约与前端类型生成、统一格式及 GitHub Actions。见 [二次开发与工程规范](docs/engineering.md)。
- 通用平台扩展：本地/S3 文件存储、目录/缩略图/回收站、实时消息、审批催办/超时提醒/流程模板、列宽排序/手机卡片/打印、原子 CSV 导入与异步导出、注册式调度、监控趋势及阈值提醒、客户反馈和可读变更审计。见 [能力与扩展方法](docs/general-platform.md)。

## 快速启动：Docker

需要 Docker Desktop / Docker Engine + Compose。前后端均通过容器构建，无需在宿主机安装 Java 或 Node。

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

macOS / Linux 使用 `cp .env.example .env`，其余命令相同。

- 前台：<http://127.0.0.1:15173/>
- 后台：<http://127.0.0.1:15173/admin>
- 登录：<http://127.0.0.1:15173/login>
- 后端健康状态：<http://127.0.0.1:18080/actuator/health>
- MySQL：`127.0.0.1:13306`，数据库 `mayday`。
- 初始账号：`admin`；示例配置的初始密码：`Mayday@2026`。

端口特意避开常见的 3306、8080、5173，可在 `.env` 修改。服务仅绑定本机回环地址。

**密码仅在首次空库初始化时生效。** 已初始化后，修改 `.env` 不会覆盖数据库账号密码；请在个人中心修改密码。默认 `SEED_DEMO_DATA=false`，仅初始化管理员与必要菜单、字典、分类和参数，不加入演示人员、组织或文章。首次体验可设置 `true`；演示成员使用随机密码，必须由管理员重置后才能登录。已有库切换开关不会增删业务数据。

```powershell
docker compose logs -f backend
docker compose stop
docker compose up -d
```

`stop` 保留数据库数据。不要通过删除数据卷的方式重置日常配置。

## 本地开发

需要 Node.js 22.12+ 或 24、Java 21、Docker。仓库附带 Maven Wrapper。

Windows 一键启动：

```powershell
.\scripts\start.ps1 -JavaHome 'D:\Soft\JDK21'
# 停止由该脚本创建的前后端进程，MySQL 保留
.\scripts\stop.ps1
```

首次会安装前端依赖、启动 MySQL、构建后端。日志在 `.local/`。已构建时可以增加 `-SkipBuild`。Docker 整套服务与本地开发使用相同端口，启动前先停止另一种模式。

也可以分别启动：

```powershell
docker compose up -d --wait mysql

# 后端（新终端；密码与 .env 保持一致）
$env:JAVA_HOME='D:\Soft\JDK21'
$env:DB_PASSWORD='MaydayDb_2026_local'
$env:ADMIN_PASSWORD='Mayday@2026'
$env:SERVER_PORT='18080'
cd backend
.\mvnw.cmd package
java -jar mayday-application/target/mayday-application-1.0.0.jar

# 前端（新终端）
cd frontend
npm ci
npm run dev
```

Java 未加入 PATH 时，使用 `$env:JAVA_HOME\bin\java.exe` 的完整路径。Unix 使用 `./mvnw`。

## 验证

```powershell
# 前端类型检查与生产构建
cd frontend
npm run build
npm run test:ui

# 后端单元测试与构建
cd ../backend
.\mvnw.cmd verify

# 真实 MySQL HTTP 回归：需要先启动后端
cd ..
node --test tests/api.test.mjs
```

推荐运行隔离验收：`node scripts/verify-baseline.mjs`。它先备份当前库，再在独立 MySQL 中验证保留数据升级、增量迁移空库安装和统一 SQL 导入安装，执行业务、审批、权限、模块开关及契约测试，检查数据/授权保持、专用数据清理及重启。审批审计数据的清理仅允许脚本生成的隔离项目，不能直接在日常库运行审批测试。

基线脚本读取本地 `.env`，不会打印凭证；数据库备份与运行日志保存在 `.local/baseline/`，不要提交到代码仓库。页面及业务验收记录在 `docs/p1-validation` 至 `docs/p5-validation`；完整交付记录见 [P6 验收](docs/p6-validation/README.md)。

需要追加业务数据重启验收时，先用 `node scripts/verify-baseline.mjs --keep-for-preview` 保留已通过的隔离项目，再运行 `node scripts/verify-persistence.mjs <该项目名>`。该检查仅接受脚本生成的隔离项目；专用业务数据保留到隔离环境销毁，不能指向日常库。

## 项目结构

```text
frontend/
  src/components/ResourcePage.tsx  通用查询、分页、权限操作、编辑弹窗
  src/components/FormModal.tsx     通用表单弹窗与提交状态
  src/components/FormDrawer.tsx    主题配置抽屉，共用表单生命周期与离开保护
  src/components/shared.tsx       标题、状态、人物标识、错误/空态
  src/lib/                       网络边界、会话管理
  src/layouts/                   后台布局与导航
  src/pages/                     工作台、系统管理、门户、个人中心
  src/types/                     严格类型协议
backend/
  mayday-common/                 统一响应、分页、异常、公共实体
  mayday-system/                 系统实体与数据访问
  mayday-security/               会话、授权策略、权限目录、审计过滤器
  mayday-content/                独立内容业务模型与数据访问
  mayday-operations/             通知、文件与审批引擎及业务关联契约
  mayday-crawler/                图片采集、列表/详情分页、持久队列与安全网络访问
  mayday-netty/                  独立 Netty UDP 转发核心、快照统计与回环打流验收工具
  mayday-workorders/             默认关闭的生成器业务示例、DTO、范围授权与版本保护
  mayday-application/            启动、配置、用例编排、接口、数据库迁移
tests/                          真实 HTTP 与 MySQL 权限回归
scripts/                        启动、生成、格式/契约检查与数据库验收
tools/generator/                模块配置示例与统一业务模板
contracts/openapi.json          从真实控制器导出的完整功能契约
database/mayday.sql              单文件空库初始化，含详细中文注释与必要基础资料
docs/                           架构、接口、权限和扩展说明
```

进一步了解：[文档导航](docs/README.md)、[复用与上线](docs/reuse.md)、[权限设计](docs/permissions.md)、[架构与扩展](docs/development.md)、[接口说明](docs/api.md)、[数据库初始化脚本](database/mayday.sql)。数据库建表、字段注释、基础数据及导入说明已统一在一个 SQL 内；已有库仍使用应用内部增量迁移升级。

范围与验收：[核心后台与内容门户开发计划](docs/development-plan.md)、[参考站核心功能实查](docs/artd-audit/README.md)。范围以开发计划及各阶段验收记录为准。

## 当前边界

这是可运行的单组织基础管理平台，包含上述已实现模块。提供基础 CRUD 模块生成、注册式任务调度和 S3 兼容文件存储；行业模块、多租户、MFA/单点登录、完整 BPMN、任意脚本调度、外部邮件/短信和任意表达式 ABAC 未实现。可配置数据范围统一来自权限目录，当前包含用户、内容与工单；通知、文件、审批和采集另有所有者/参与者访问规则。用户邮箱和电话、审批字段按独立策略控制，不能直接推广成所有业务的通用字段权限。

用户与内容使用显式 DTO，基础资料共享模型以减少重复；若业务规则增长，应拆出专用实体与服务。登录/反馈限流、拼图验证和实时事件分发是单实例内存实现，多实例部署需共享限流、原子消费及事件总线，文件使用共享持久存储。自托管拼图只提供基础自动化门槛，不替代专业风控或 MFA。生产环境需要自己的数据库凭证、HTTPS 入口、备份与日志保留策略。

技术参考：[Ant Design 6](https://ant.design/components/table/)、[Spring Boot](https://docs.spring.io/spring-boot/)；依赖版本以锁文件和 Maven 配置为准。

## 已有环境升级

先完成隔离验收，再运行 `node scripts/upgrade-local.mjs`。脚本保留旧镜像、停止业务写入后备份 MySQL，再更新前后端并比较原有业务字段和授权。恢复与故障处理见 [升级说明](docs/upgrade.md)。不要用删卷或改写已执行迁移来修复升级。

## 二次开发工具与工程检查

提供安全的 CLI 模块生成器、项目模块开关、真实控制器 OpenAPI、TypeScript 类型生成及 GitHub Actions。

- 使用流程、代码规范和边界见 [工程规范](docs/engineering.md)。
- 工单示例默认关闭；配置 `MODULE_WORKORDERS_ENABLED=true` 后重启即可使用，并需为普通角色独立授权。
- `node scripts/check-project.mjs` 检查前端格式、契约、模型、交互、类型和生产构建。
- 后端 `verify` 同时检查 Java 格式与测试；修改格式用 `-pl '!mayday-netty' spotless:apply`，UDP 独立测试模块保留自己的构建配置。
- `node scripts/verify-baseline.mjs` 在独立库验证空库、旧库保留数据升级、唯一 SQL 安装、权限、模块裁剪和在线契约。日常库不写入测试数据。
