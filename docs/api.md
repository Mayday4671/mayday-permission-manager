# API 使用说明

## 协议

统一前缀 `/api`。除 `/auth/login`、`/auth/captcha/challenge`、`/auth/captcha/verify`、`/platform/features`、`/public/**` 和健康检查外都需要：

```http
Authorization: Bearer <登录返回的令牌>
Content-Type: application/json
```

成功：`{ "success": true, "data": ..., "message": "操作成功" }`。
失败：`{ "success": false, "data": null, "message": "可读错误信息" }`，同时返回真实 HTTP 状态：400 校验、401 认证、403 授权、404 资源不存在或模块关闭、409 冲突、429 限流、500 内部失败。

列表 `data` 包含 `items`、`total`、`page`、`size`。页码从 1 开始，每页最多 100 条。默认按 ID 倒序；列表接受 `keyword/page/size`，用户和基础资料额外接受 `enabled`，内容接受 `published`，日志接受 `success`。用户还支持 `departmentId`。

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
- `GET /system/logs`：只读审计分页。

## UDP 转发

`GET/PUT /relay/config` 管理单路持久配置，`GET /relay/interfaces` 读取本机网卡信息，`GET /relay/stats` 获取实时快照（包含实际监听/发送地址和最近发包源），`POST /relay/start` 和 `POST /relay/stop` 管理运行批次。查看、修改、启停分别授权，修改携带配置 `version`，停止携带当前 `runId`。字段、计数口径及部署限制见 [UDP 转发](udp-relay.md)。

## 用户

- `GET/POST /system/users`：查询或创建。
- `PUT/DELETE /system/users/{id}`：编辑或删除。
- `PUT /system/users/{id}/password`：`password`，独立重置密码。
- `GET /system/users/export`：按 100 条分批获取，权限、筛选和脱敏与列表保持一致。

创建字段：`username/nickname/password/email/phone/departmentId/enabled/roleIds`。编辑添加 `version`，用户名不允许修改；密码请使用独立接口。

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
- 文件：`/operations/files`（GET/POST multipart file），`/operations/files/{id}`（DELETE）；业务附件分别走 `/operations/messages/{messageId}/attachments/{fileId}` 或 `/operations/notifications/{notificationId}/attachments/{fileId}`。

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

## 审批实例

- `GET /operations/requests?box=mine|todo|done|participated|all`；all 单独鉴权。`GET .../{id}` 与 `/{id}/history` 返回按参与权和字段读权过滤的详情/历史。
- `POST /operations/requests`：`definitionId/versionId/title/values`；内容审批再传 `businessId/businessRevisionId/businessVersion`。必须绑定当前已发布流程版本及文章当前修订。
- `POST /operations/requests/{id}/decision`：`version/taskId/action/comment/targetUserId/values`。action 为 APPROVE/REJECT/WITHDRAW/COMMENT/TRANSFER/ADD_SIGN；驳回和评论需要内容，转交/加签需要目标用户。values 只能包含当前节点可写字段。
- `GET .../{id}/files/{fileId}` 检查字段附件读权；`GET .../{id}/content-files/{fileId}` 检查送审内容快照附件。
- `GET .../{id}/events`、`POST .../{id}/retry-notifications` 为审批管理员的可靠通知运维入口。
- 工作台待办使用 `/operations/requests?box=todo&page=1&size=3`，需要同时具有 `requests:view` 和 `requests:approve`。数据库按当前账号的待处理任务筛选，不会把后续尚未到达的节点或其他审批人的任务返回给首页。
- 到达审批节点、转交和加签会创建对应人员的待办及站内通知；结束时通知申请人。事件与审批事务共同提交，由后台每 3 秒扫描投递并重试失败事件；工作台和顶栏在页面可见时每 15 秒轮询，重新聚焦时也会刷新。它不是 WebSocket 推送；离线用户登录后可查看持久化通知。已读只影响消息数量，必须执行审批动作才能清除待办，处理结果会立即触发前端相关查询刷新。

关键词按字面量匹配，`%`、`_` 不解释为通配符。客户端不得以角色名称推断权限；校验以实际 DTO、PermissionCatalog 和服务层为准。版本过期应重新取得最新记录并让用户核对，不能自动覆盖重试。

## 可选模块和机器契约

- `GET /platform/features`：公开返回有效模块状态，没有账号或配置秘密。关闭依赖的模块由服务端联动关闭。
- `GET /platform/openapi`：管理员读取真实控制器生成的 OpenAPI；关闭的模块不出现在当前实例文档中。可用 `API_DOCS_ENABLED=false` 禁用。
- `GET/POST /business/workorders`、`GET/PUT/DELETE /business/workorders/{id}`：可运行的生成器示例，默认关闭。读写分别检查 `workorders:view/create/update/delete` 和行级数据范围；编辑请求的 `version`、删除查询参数的 `version` 用于并发冲突检查。

`contracts/openapi.json` 和 `frontend/src/types/generated/api.ts` 通过脚本生成和比对。新模块使用明确响应 DTO 与统一契约客户端，详见 [工程规范](engineering.md)。
