# API 使用说明

## 协议

统一前缀 `/api`。除 `/auth/login`、`/auth/captcha/challenge`、`/auth/captcha/verify`、`/platform/features`、`/public/**` 和健康检查外都需要：

```http
Authorization: Bearer <登录返回的令牌>
Content-Type: application/json
```

成功：`{ "success": true, "data": ..., "message": "操作成功" }`。
失败：`{ "success": false, "data": null, "message": "可读错误信息" }`，同时返回真实 HTTP 状态：400 校验、401 认证、403 授权、404 资源不存在或模块关闭、409 冲突、413 请求过大、429 限流、500 内部失败。

应用为每次请求生成 `X-Request-ID` 并关联日志，忽略客户端同名头；前端服务错误显示有效的定位号，不能用它作为身份或授权依据。代理自身拒绝的请求可能没有此头。匿名健康端点仅公开 `/actuator/health`、`/actuator/health/liveness` 和 `/actuator/health/readiness`，就绪探针包含数据库连通且不公开组件详情。

列表 `data` 包含 `items`、`total`、`page`、`size`。页码从 1 开始，每页最多 100 条。默认按 ID 倒序；列表接受 `keyword/page/size`，用户和基础资料额外接受 `enabled`，内容接受 `published`，日志接受 `success`。用户还支持 `departmentId`。

文件和 CSV 上传使用 `multipart/form-data`，由客户端自动设置 boundary；下载返回二进制或 CSV，不使用 JSON 包装。SSE 流返回 `text/event-stream`。各接口的特殊条数上限以对应说明为准。

## 身份

- `POST /auth/captcha/challenge`：`username`，返回 `challengeId/background/piece/width/height/pieceSize/y/expiresIn`。图片是 PNG data URL，不返回缺口横坐标；有效期 120 秒，换图作废该账号/来源的旧题。
- `POST /auth/captcha/verify`：`challengeId/username/x/elapsedMs`，x 是原图坐标，不是缩放后的屏幕像素；通过返回 `captchaToken/expiresIn`，凭证有效期 60 秒。每题只允许一次验证，失败必须换题。
- `POST /auth/login`：`username/password/captchaToken`，返回 `token`。验证凭证绑定账号/来源且只能使用一次；缺少、伪造、过期、换账号使用或重放返回 400。密码错误返回 401，同时消费验证凭证，不能重复尝试密码。保留原登录失败限流。
- `GET /auth/me`：自身资料、权限字符串列表、支持数据范围的资源摘要、admin 标识。资源集合从 PermissionCatalog 的 scoped 标记派生。
- `POST /auth/logout`：撤销当前会话。
- `PUT /auth/profile`：`nickname/email/phone`，不允许更改组织和角色。
- `PUT /auth/password`：`oldPassword/newPassword`，成功后所有会话失效。

拼图及凭证响应 `Cache-Control: no-store`，不写入 URL、数据库或日志正文。每来源最多获取 120 题/分钟，全局挑战/凭证/来源窗口各上限 2048；当前是单实例内存状态，服务重启会要求重新验证。多实例应使用共享存储与原子消费。本地拼图是基础自动化门槛，不代表无法被图像识别算法自动完成；高风险部署仍需专业风控/MFA。

## 工作台与系统

- `GET /dashboard`：授权范围内指标、7 日审计趋势、最近日志和内容。
- `GET /system/navigation`：过滤权限后的启用菜单。
- `GET /system/lookups`：最小化部门选项、可委托角色选项。
- `GET /system/logs`、`GET /system/logs/{id}`：日志分页与详情，`loginOnly` 区分登录日志和操作日志，分别检查对应权限。支持 `keyword/success/from/to/page/size`。
- `GET /system/logs/export`：相同筛选，按 100 条分批；`DELETE /system/logs`：`{before,loginOnly}`，至少保留最近 30 天，分别需要导出/清理权限。
- `GET /system/changes`、`GET /system/changes/{id}`：关键业务字段变更审计，使用 `logs:view`；列表支持 `keyword/page/size`。返回白名单字段的 before/after，不提供任意实体或敏感字段查询。

## UDP 转发

`GET/PUT /relay/config` 管理单路持久配置，`GET /relay/interfaces` 读取本机网卡信息，`GET /relay/stats` 获取实时快照（包含实际监听/发送地址和最近发包源），`POST /relay/start` 和 `POST /relay/stop` 管理运行批次。查看、修改、启停分别授权，修改携带配置 `version`，停止携带当前 `runId`。字段、计数口径及部署限制见 [UDP 转发](udp-relay.md)。

## 用户

- `GET/POST /system/users`：查询或创建。
- `PUT/DELETE /system/users/{id}`：编辑或删除。
- `PUT /system/users/status`：`{rows:[{id,version}],enabled}`，单批 1–100 个账号，需 `users:update`，逐项检查数据范围、角色管理边界及内置账号保护，任一失败整批回滚。
- `PUT /system/users/{id}/password`：`password`，独立重置密码。
- `GET /system/users/export`：按 100 条分批获取，权限、筛选和脱敏与列表保持一致。

创建字段：`username/nickname/password/email/phone/departmentId/enabled/roleIds`。编辑添加 `version`，用户名不允许修改；密码请使用独立接口。

## CSV 导入与后台导出

当前注册资源为 `users`，新增业务通过 `BulkResourceAdapter` 接入；不是所有表都自动具备导入导出能力。

- `GET /bulk/users/template`：下载按当前写权限裁剪的 UTF-8 CSV 模板。
- `POST /bulk/users/import/preview`：multipart `file`，最多 2 MB、1000 行，返回原记录号和逐行错误；只校验，不写业务数据，密码只显示是否提供。
- `POST /bulk/users/import/commit?idempotencyKey=...`：重新上传校验后的原文件，键为 16–64 位字母/数字/连字符。同账号、资源、键和文件重复提交返回原任务；同键不同内容拒绝。只创建新用户，任一行失败整批回滚。
- `POST /bulk/users/exports`：`{keyword,enabled,departmentId}`，创建后台 CSV 导出，最多 10 万行，复用用户列表范围与字段授权。
- `GET /bulk/jobs`：当前账号最近 20 个任务；`GET /bulk/jobs/{id}`：状态与进度；`GET /bulk/jobs/{id}/download`：本人成功导出的结果。任务状态为 QUEUED/RUNNING/SUCCEEDED/FAILED。

导入需要 `users:import/create` 和 ALL 用户范围，角色/部门/联系方式仍独立检查。导出需 `users:view/export`；执行和下载重新检查账号、权限和范围变化。结果保留 24 小时；每人最多 2 个活动导出，工作器及待执行队列有界。导出工作器当前单实例，重启将未完成导出标为失败，需重新创建；不是可跨节点恢复的长任务平台。

## 角色

- `GET/POST /system/roles`，`PUT/DELETE /system/roles/{id}`。
- `GET /system/roles/permissions`：服务端权威权限目录。

角色字段：`code/name/description/enabled/permissions/dataScopes/version`。

```json
{
  "code": "writer",
  "name": "内容作者",
  "description": "撰写自己的草稿",
  "enabled": true,
  "permissions": [
    "dashboard:view",
    "notices:view",
    "notices:create",
    "notices:update"
  ],
  "dataScopes": { "users": "SELF", "notices": "SELF" }
}
```

## 基础资料

- `GET/POST /system/entries/{kind}`。
- `PUT/DELETE /system/entries/{kind}/{id}`。
- 当前源码 kind 接受 `departments/menus/dictionaries/settings/posts/categories/tags/approvalcategories`；各项均有实际页面。

共享字段：`name/code/value/description/parentId/sortOrder/enabled/version`。菜单额外使用 `path/permission`；当前仅部门允许父节点并检查循环，菜单要求 parentId 为空。导航按 sortOrder 排序，按业务语义组平铺展示菜单。

## 内容与门户

- `GET/POST /content/notices`，`GET/PUT/DELETE /content/notices/{id}`。列表支持 keyword、status、categoryId 与分页；删除进回收站。
- 草稿字段：`title/categoryId/summary/content/tagIds/coverId/attachmentIds/visibility/seoTitle/seoDescription/sortOrder/pinned/recommended/requiresApproval/version`。旧 category、tags、published 请求保持兼容，但新客户端使用稳定 ID 与独立发布动作。
- 每次编辑生成不可变修订，返回 `revisionId/revisionNumber/status/liveRevisionId/publiclyVisible`。草稿状态和实际前台展示分别判断。
- `POST /content/notices/{id}/publish`：`version/revisionId/publishAt/offlineAt`；时间为空立即发布。`POST .../offline`：`version`。
- `GET .../{id}/revisions` 和 `GET .../{id}/publications` 查询修订及上线历史。
- `GET /content/notices/recycle`；`POST .../{id}/restore` 带 version，恢复为草稿；`DELETE .../{id}/purge` 只允许未被审批历史引用的回收站记录。
- `GET /public/site` 只公开站点白名单；`GET /public/taxonomy` 返回启用分类和标签。
- `GET /public/articles` 支持 keyword/categoryId/tagId/recommended/page/size；`GET /public/articles/{id}` 只返回在线公开修订，未公开和不存在均 404。
- `POST /public/articles/{id}/view` 记录一次详情访问；轮询 GET 不增加统计。浏览次数是请求计数，不宣称独立访客数。
- 公开封面 `GET /public/articles/{id}/cover`，附件 `GET /public/articles/{id}/files/{fileId}`；后台修订文件 `/content/notices/{id}/revisions/{revisionId}/files/{fileId}`。

## 参数、字典与网站

- 字典项：`/system/dictionaries/{id}/items`（GET/POST），`/system/dictionaries/{id}/items/{itemId}`（PUT/DELETE）。值在同一类型内唯一。
- `/system/options/{kind}` 返回最小异步选择项；kind 支持 users/categories/tags/approvalcategories。
- `/system/site-config`（GET/PUT）、`/system/site-config/refresh`（POST），保存时携带各项 version。公共配置与内部参数分开。
- 前台主题使用 `site.theme` 参数，value 是白名单 JSON 字符串；单独提交该键的 value/version。`mode/primaryColor/borderRadius/compact` 必填，新增的导航、背景、容器、宽度、图表和状态色可缺省以兼容旧配置。字段枚举及默认值见 [主题配置](themes.md)。`GET /public/site` 返回完整、规范化的 theme 对象，保存需要 settings:update，非法显式值或未知字段拒绝，过期版本返回 409。
- 部门增加 leaderId/icon，用户增加 postIds；角色自定义范围通过 scopeDepartments 传入，具体契约以 Contracts 为准。

## 通知与收件箱

- `/operations/notifications`（GET/POST），`/{id}`（GET/PUT/DELETE），`/{id}/publish`、`/{id}/withdraw`、`/{id}/copy`（POST）。发布/撤回带 version。
- 发布模型包括标题、摘要、富文本正文、类型、附件 IDs、recipientType（ALL/DEPARTMENTS/ROLES/USERS）、recipientIds、expiresAt。targetType/targetId 为服务端生成的业务关联，只读返回。已发布正文不能原地修改，可复制成草稿。
- `/{id}/recipients` 查实际投递/阅读记录；`/operations/notifications/options/{kind}` 取授权范围内目标选项。
- `/operations/messages`、`/messages/unread`、`/messages/{id}`（GET）；`/messages/{id}/read`、`/messages/read-all`（POST）。message ID 是当前人的投递 ID，不是通知批次 ID。
- 工作台未读预览使用 `/operations/messages?read=false&page=1&size=3`，`total` 是全部未读数量；顶栏使用 `/messages/unread`。两者都需要 `messages:view`，仅返回当前账号实际收到且尚未撤回/过期的投递。打开详情重新鉴权后标记已读，失败时保留重试入口。
- 业务附件分别走 `/operations/messages/{messageId}/attachments/{fileId}` 或 `/operations/notifications/{notificationId}/attachments/{fileId}`，再次检查当前业务查看权与实际附件关联。

## 文件中心

- `GET /operations/files`：`keyword/directoryId/deleted/page/size`；directoryId 不传查询全部目录，0 表示根目录。`GET .../{id}` 读取有权访问的元数据。
- `POST /operations/files`：multipart `file` 与可选 directoryId；`GET .../storage-info` 只返回存储类型、上传字节上限和扩展名白名单。
- `GET /operations/files/directories`；`POST .../directories`：`{name,parentId}`；`PUT .../directories/{id}`：`{name,parentId,version}`；`DELETE .../directories/{id}?version=...`。目录按所有者隔离，检查父链循环、重名和引用，不能删除非空目录。
- `GET /operations/files/{id}/download`、`/preview`、`/thumbnail`：需要文件下载权及所有权/全量管理权。安全图片可预览，其余类型走附件下载，不能执行上传 HTML；缩略图与原图采用相同授权。
- `DELETE /operations/files/{id}`：移入回收站。`POST /operations/files/batch`：`{action,ids,directoryId?}`，action 为 MOVE/RECYCLE/RESTORE/PURGE，单批最多 100 个 ID，任一所有权、关联或状态检查失败整批回滚。

目录新增/修改/删除分别使用 `files:create/update/delete`；移动需要 `files:update`，回收、恢复、永久删除分别需要 `files:delete/restore/purge`。永久删除只接受回收站数据，先记录持久清理意图，后台删除存储对象成功后才删元数据；失败保留原因供重试，已提交永久删除不能恢复。通知、内容修订、审批及采集引用中的文件禁止回收/永久删除。

新上传采用 LOCAL 或 S3，旧 MYSQL 正文仍可读；存储 key、对象端点和凭据不返回前端。默认上限 10 MB，可配置 1–100 MB；暂无恶意文件扫描与分片续传。

## 实时刷新

`GET /operations/realtime/stream` 复用 Authorization Bearer 头，至少具有 `messages:view` 或 `requests:view`。返回 ready/heartbeat/changed 事件，payload 只有 `{topics,time}`；topics 按当前权限裁剪为 messages/requests，没有业务正文或用户清单。主令牌不允许放入 URL。

SSE 在业务事务提交后发送刷新提示，客户端重新调用授权查询；每次发送和 10 秒心跳重查会话与权限，失去某个领域权限后裁剪对应主题，全部订阅权限或会话失效时关闭。每账号最多 4 条、全站 500 条连接，5 分钟轮换。当前单实例、无历史事件重放，前端断线重连重新取数并保留 15 秒轮询兜底。

## 客户反馈

- `POST /public/feedback`：`{type,title,content,articleId?,contact?}`，type 为 QUESTION/SUGGESTION/CORRECTION，返回一次性展示的 48 位随机 receipt 与创建时间。
- `POST /public/feedback/track`：`{receipt}`，只返回状态和公开回复；查询码仅放正文，数据库仅存摘要，无匿名列表/按 ID 查询。当前按连接来源每小时最多 10 次提交、120 次查询，计数为进程内状态。
- `GET /operations/feedback`、`GET .../{id}`：后台按 keyword/status/page/size 查询，需 `feedback:view`；详情包含内部处理历史。
- `POST .../{id}/process`：`{version,assigneeId,status,publicReply,internalNote}`，需 `feedback:process`，更改处理人另需 `feedback:assign`。status 为 OPEN/PROCESSING/RESOLVED/CLOSED，解决时必须填写公开回复。
- `GET .../assignees?keyword=...`：分配候选仅返回有查看/处理权的有效账号 ID 与名称，不提供通讯录；分配成功可产生站内通知。

公开回复和内部备注严格分离，匿名查询不会返回联系人、处理人或内部备注。当前是共享后台反馈权限，不按用户/部门划分处理范围。

## 服务监控与任务调度

- `GET /operations/monitor`：JVM 堆、进程 CPU、线程、运行时间、数据库连通与延迟快照，需 `monitor:view`。CPU 不可用返回 -1，不伪造 0。
- `GET /operations/monitor/history?minutes=60`：本次进程节点最近 5–60 分钟、最多 120 点；每 30 秒采样，保留 7 天。进程重启开始新曲线。
- `GET/PUT /operations/monitor/policy`：编辑包含 version/enabled/heapThresholdPercent/databaseThresholdMs/alertUserId，修改另需 `monitor:configure`。`GET .../recipients` 返回有监控查看权的有效接收人候选。启用后超阈值发站内提醒，冷却 30 分钟；数据库离线时不能向同一个故障库承诺持久化采样/提醒。
- `GET /operations/scheduler/handlers`：实际注册的 JobHandler；`GET .../recipients`：有调度查看权的提醒接收人候选。
- `GET/POST /operations/scheduler`、`PUT/DELETE .../{id}`：任务配置；编辑为 `{name,handler,cron,description,enabled,alertUserId,version}`，cron 为六段表达式。`POST .../{id}/run` 需独立 `scheduler:execute`。
- `GET /operations/job-logs`：按 keyword/jobId/page/size 查询真实执行结果；删除配置不删除独立执行历史。失败先回滚业务事务，再保存失败记录；站内失败提醒独立重试最近一天未完成的最早 100 条，已投递项退出队列，不回滚执行结果。未配置或失效接收人明确跳过，恢复权限后不补发这批历史提醒；消息模块关闭时保留待发状态。

调度只执行注册处理器，不接收任意 SQL、脚本、类名或 URL。默认数据库事务超时 30 秒，适合短维护用例，但不能强制中断任意 CPU 运算或外部调用；长任务应提交专用队列，外部副作用需自身幂等。监控和调度未作为集群故障管理平台验收。

## 图片采集

前端入口分别为 `/admin/crawler`（采集数据）与 `/admin/crawler-config`（采集配置），两者使用独立页面与查询状态。后端保留原任务 ID 作为数据来源及所有者追溯，不要求先访问配置页才能读取数据。

V15 起，DELETE `/crawler/tasks/{id}` 对已经产生文章的配置采用归档：配置列表和配置详情不再可见，编辑/启动/停止/重试拒绝；文章列表、正文、图片接口继续按原所有者和 `crawler:download` 权限读取，数据不级联删除。没有文章的空配置仍可物理清理，已保存文件保留。不能删除正在排队或运行的配置，须先停止。`archived` 是服务器内部状态，不接受客户端赋值。

默认跨任务卡片：`GET /crawler/tasks/articles?keyword=&page=1&size=24`；单任务卡片：`GET /crawler/tasks/{id}/articles?keyword=&page=1&size=12`（每页最多 24 篇）。卡片新增 `taskId/taskName/taskStatus/imageLimit`，其中 `imageLimit` 是整个任务的图片限额。跨任务列表先在 SQL 内限制任务所有权，再统计总数、搜索和分页，普通账号不能读取他人的标题或文章总数。

文章详情：`GET /crawler/tasks/{id}/articles/{articleId}`，返回元数据、按页排序的正文纯文本与全部已入库且去重的配图，供右侧抽屉缩略图和全屏预览使用。全部入口检查任务权限及所有权，详情额外检查文章所属任务。配图继续用现有鉴权图片接口读取，不提供外站图片直链。

`CrawlRules.article` 可配置 `{enabled,title,content,author,publishedAt}`；字段根据文章所在页面格式解释为 CSS 选择器或 JSON Pointer。旧规则未携带该对象时采用自动识别，已完成旧任务不会自动重跑。入口预览响应新增 `article`（标题、正文、作者、发表时间、截断标记）；列表进入详情模式的入口预览不返回文章正文。

`/crawler/tasks`：GET 分页列表、POST 创建；`/{id}` GET/PUT/DELETE；`/{id}/start`、`/{id}/stop`、`/{id}/retry` POST，动作携带 `{version}`。`/{id}/items` GET 可按 kind/status 筛选，采用公共 page/size 约定。`/{id}/items/{itemId}/image?download=true` GET 返回鉴权后的图片二进制，检查当前账号与任务、结果文件的关联。`/preview` POST 接收完整 CrawlRules，只解析入口页，不写文件。编辑参数为 `{name,rules,version}`，规则结构和示例见 [图片采集](image-crawler.md)。全部接口经过统一认证；额外 `crawler:all` 才能管理他人任务。

## 审批定义与设计器

- `/operations/workflows`（GET/POST），`/{id}`（GET/PUT/DELETE），`/{id}/publish`（POST，version），`/{id}/versions`（GET）。发布版本不可修改，草稿编辑后发布新的版本号。
- 定义字段：`name/code/description/categoryId/businessType/enabled/schema/version`；businessType 为 GENERAL 或 CONTENT。
- schema 包含 fields、nodes、startNodeId、applicantType/applicantIds、allowSelfApproval、allowRepeatApproval、allowWithdraw。字段和节点均使用稳定 ID；详见 `WorkflowSchema.java` 与 `types/workflow.ts`。
- `GET /operations/workflows/options?businessType=CONTENT` 只返回当前可发起的已发布流程和表单；`GET .../roles` 返回流程用角色选项。
- `POST /operations/workflows/simulate` 输入 schema/applicantId/values，只校验并返回运行路径，不落审批数据或通知。
- `GET /operations/workflows/templates` 返回可复用表单/节点模板，使用 `workflows:view`；模板复制为草稿后才可发布。节点可配置 timeoutMinutes，到期产生提醒，不自动审批。

## 审批实例

- `GET /operations/requests?box=mine|drafts|todo|done|participated|copies|all`；all 单独鉴权。`GET .../{id}` 与 `/{id}/history` 返回按参与权和字段读权过滤的详情/历史。
- `POST /operations/requests`：`definitionId/versionId/title/values`；内容审批再传 `businessId/businessRevisionId/businessVersion`。必须绑定当前已发布流程版本及文章当前修订。
- `POST /operations/requests/{id}/decision`：`version/taskId/action/comment/targetUserId/targetNodeId/values`。action 为 APPROVE/REJECT/RETURN/TERMINATE/WITHDRAW/COMMENT/TRANSFER/ADD_SIGN；驳回、退回、终止和评论需要原因或内容，转交/加签需要目标用户。values 只能包含当前节点可写字段。
- `POST /operations/requests/drafts` 保存未提交草稿；`PUT /operations/requests/{id}` 保存本人草稿/退回/撤回后的修改；`POST .../{id}/submit` 完整校验后提交或重提。编辑体为 `version/title/values/businessVersion`；不能换发起人、流程或业务修订。
- `DELETE /operations/requests/{id}?version=...` 只删除本人未提交草稿，正式申请不能删除。`POST .../{id}/copies/read` 只标记本人的抄送已读，不改变申请版本。
- RETURN 的 targetNodeId 为空表示退回申请人修改；指定 ID 只能来自详情 returnTargets 中当前有效路径的已办节点。TERMINATE 单独要求 requests:manage，不替代审批人决定；终止、终止性驳回和通过不能重提。
- 实例 runNumber 区分提交轮次，任务 nodeVisit 区分节点重办批次；history 的 submittedValues 为各轮提交的权限裁剪快照。`status` 可单独过滤实例状态，全部申请不含他人的未提交草稿。
- `GET .../{id}/files/{fileId}` 检查字段附件读权；`GET .../{id}/content-files/{fileId}` 检查送审内容快照附件。
- `GET .../{id}/events`、`POST .../{id}/retry-notifications` 为审批管理员的可靠通知运维入口。
- `POST /operations/requests/{id}/remind`：`{version}`，需 `requests:remind`，申请人可催办自己的运行中申请，审批管理员另需 `requests:manage`；30 分钟冷却，通知当前有效待办人。
- 工作台待办使用 `/operations/requests?box=todo&page=1&size=3`，需要同时具有 `requests:view` 和 `requests:approve`。数据库按当前账号的待处理任务筛选，不会把后续尚未到达的节点或其他审批人的任务返回给首页。
- 到达审批节点、转交和加签会创建对应人员的待办及站内通知；结束时通知申请人。事件与审批事务共同提交，由后台每 3 秒扫描投递并重试失败事件。工作台和顶栏通过 SSE 提示立即重新取数，并在页面可见时每 15 秒轮询兜底，重新聚焦也刷新；离线登录后读取持久通知。已读只影响消息数量，必须执行审批动作才能清除待办；超时提醒同样不会代替业务决定。

关键词按字面量匹配，`%`、`_` 不解释为通配符。客户端不得以角色名称推断权限；校验以实际 DTO、PermissionCatalog 和服务层为准。版本过期应重新取得最新记录并让用户核对，不能自动覆盖重试。

## 审批连续性

- `GET /operations/delegations?box=mine|received&page=1&size=6`：仅本人创建或收到的安排，SQL 分页，不接受任意账号查询。需要 `requests:delegate/approve/view`。
- `GET /operations/delegations/scopes`：已发布启用流程名称候选，不返回模型、表单或人员。
- `POST /operations/delegations`：`targetId/startsAt/endsAt/definitionIds/reason`；空范围表示全部。身份取自会话，最长 90 天，时段采用北京时间且左闭右开；接收人检查启用、审批/查看权及用户数据范围。
- `POST /operations/delegations/{id}/revoke`：`{version}`，只有本人可撤销；到期/撤销不自动收回已经激活的任务。
- `POST /operations/requests/{id}/handover`：`{version,fromUserId,targetUserId,reason}`，需 `requests:manage/reassign` 与 `users:view` 数据范围。当前及未来审批人员的实例级交接，保留顺签顺序、原任务历史和期限；退回重提保留覆盖，发布版本不变。
- 详情 `canHandover/handoverSources` 由服务端授权裁剪；普通参与者不返回未来人员修复目录。任务增加 `originalAssigneeId/originalAssigneeName/delegationId/assignmentNote`，历史增加 DELEGATE/HANDOVER；不允许客户端修改这些来源字段。

所有动作继续检查版本和当前权限。接收人不能自审或制造同一路径重复审批；委托条件不适用时回到原人办理，不自动通过。用户权限撤销在接口立即生效。

## 门户栏目与首页

- `GET /portal-management/channels`、`GET /portal-management/category-options`、`GET /portal-management/home`：要求 `portal:view`，分别返回管理栏目、有序分类候选、首页编排与原版本。
- `POST /portal-management/channels`、`PUT /portal-management/channels/{id}`、`DELETE /portal-management/channels/{id}?version=...`：要求对应 create/update/delete 及 view 权限。字段为 `code/name/template/description/sortOrder/enabled/categoryIds/version`；template 为 GUIDE/NOTICE/UPDATE/STORY，分类列表顺序即展示次序。访问名称创建后固定，历史引用禁止移走或删除。
- `PUT /portal-management/home`：`version/heroArticleId/noticeArticleId/featuredArticleIds/allowThemeToggle/nightPrimaryColor`；要求 `portal:update` 与查看权。逐篇检查公开线上状态及 `notices:view` 数据范围，公告必须属于 NOTICE 模板，精选最多 12 篇且不能重复。
- `PUT /portal-management/theme-policy`：仅更新 `version/allowThemeToggle/nightPrimaryColor`，同样要求 `portal:view/update`；不改写首页文章选择，也不因已有文章下线而阻止主题策略修改。
- `GET /content/notices/portal-options`：要求 `notices:view`，内容编辑者可以取得栏目与分类选项，无须额外获得栏目管理权限。管理内容列表支持 `portalChannelId/categoryId/portalTemplate/publiclyVisible`；公开选择模式按线上标题与归属过滤，仍受作者/部门数据范围限制。响应 `liveTitle/livePortalChannelId` 与当前草稿字段分开。
- `GET /public/site`：匿名白名单配置、启用栏目及栏目内启用分类、独立主题策略；不返回后台管理版本或凭据。
- `GET /public/home`：匿名返回当前公开主视觉、公告与有序精选，指定内容下线后不泄露配置 ID。自动主视觉和公告独立查询对应模板。
- `GET /public/articles?channel=<code>&categoryId=<id>&keyword=...&page=1&size=12`：栏目、分类、有效期、线上修订进入分页 SQL；不存在或停用栏目返回 404。正文、封面与附件使用相同公开边界。页面约定与运营规则见 [门户说明](portal.md)。

## 可选模块和机器契约

- `GET /platform/features`：公开返回有效模块状态，没有账号或配置秘密。关闭依赖的模块由服务端联动关闭。
- `GET /platform/openapi`：管理员读取真实控制器生成的 OpenAPI；关闭的模块不出现在当前实例文档中。可用 `API_DOCS_ENABLED=false` 禁用。
- `GET/POST /business/workorders`、`GET/PUT/DELETE /business/workorders/{id}`：可运行的生成器示例，默认关闭。读写分别检查 `workorders:view/create/update/delete` 和行级数据范围；编辑请求的 `version`、删除查询参数的 `version` 用于并发冲突检查。

`contracts/openapi.json` 和 `frontend/src/types/generated/api.ts` 通过脚本生成和比对。新模块使用明确响应 DTO 与统一契约客户端，详见 [工程规范](engineering.md)。
