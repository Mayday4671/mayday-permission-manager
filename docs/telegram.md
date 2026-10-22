# Telegram 模块部署与验收

## 模块能力与边界

Telegram 是随 Mayday 主应用装配的独立 `mayday-telegram` Maven 模块，默认关闭。入口位于后台“Telegram”菜单；关闭时菜单隐藏、Telegram API 被模块守卫拒绝，原有系统不依赖 TDLight native。业务数据通过 MyBatis-Flex/MySQL 保存，采集文件使用平台 `FileStorage`，TDLib 加密会话保存在服务端配置的私有目录。

当前代码支持单个授权用户账号的连接状态与授权挑战、受控机器人搜索及原始消息查看、按钮快照、候选来源链接识别，以及已加入频道/可访问消息链接的有界历史采集。采集任务最多保存 500 条历史消息，可按包含式日期范围过滤；任务支持暂停、继续、取消、失败重试、服务端消息分页和媒体状态查看。完成且未设置结束日期的频道任务可由用户单独启用定期追赶：最多每 30 秒检查一次，使用独立于历史回填的游标/租约，最多检查 10,000 条后自动停止；此功能是有界轮询，不是 Telegram 推送，也不保证即时或完整送达，不会自动加入频道。采集策略可选择仅保存文本/附件元数据，或保存图片、视频、文档。取消任务会停止排队中的媒体下载；已开始的下载即使完成也不会在任务取消后发布为可访问文件，重连时也不会重新排队。媒体下载使用有界后台工作线程、数据库租约、三次尝试上限和平台文件存储。图片/文件读取要求实时校验 `telegram:view`、`telegram:download`、数据范围、原消息可保存状态和任务下载策略。原始 TDLib 文件 ID、磁盘路径和媒体存储键不会返回给浏览器。

已实现的媒体 HTTP 能力包括鉴权图片/文件内容，以及 MP4/WebM 的十分钟短期播放票据与单 Range 流式读取。浏览器兼容性不足或需要拖动播放时，用户可排队生成 HLS 点播预览；服务器仅处理本地受控源文件，最多 2 小时、每预览最多 1 GiB 输出，并把清单/分片写入统一文件存储。HLS 的每个请求都重新校验 `telegram:download`、用户数据范围、父任务、原消息可保存状态及预览资产所有权；HLS 不包含加密密钥、外部 URL 或可从前端传入的文件路径。预览有跨实例租约、并发与空间预留、失败重试和自动留存清理。支持 MSE/HLS.js 的浏览器使用鉴权 HLS；其余浏览器可回退到受短期票据保护的原始 MP4/WebM 播放。当前 HTTP Range 仅支持一个字节区间。

已增加 ZIP/RAR/7z 按需目录浏览：权限需同时包含 `telegram:download` 与 `telegram:extract`。页面服务端分页列出最多 5,000 个目录项，并限制归档实际大小、目录声明总展开大小和单条提取大小。部署镜像提供 7-Zip；ZIP 由 Java 标准库读取，RAR/7z 由参数数组启动 7-Zip，无 shell 拼接，单文件提取到进程私有临时文件并在响应关闭后删除。条目名不会用作磁盘路径；拒绝路径穿越、符号链接、加密条目、分卷归档、递归提取及超限内容。支持识别的图片、MP4/MP4 兼容媒体预览和单字节区间请求。归档正文不会写入数据库。

Telegram 下载配额和自动保留清理由受保护的服务端环境配置控制：每个附件最大字节数、整个模块的保守存储预留上限、最低剩余磁盘空间、并发下载数、单次下载超时和保留天数。清理只处理到期且已经下载完成的媒体正文，使用数据库租约和幂等存储删除；失败记录会延迟重试，附件元数据仍保留。保留天数设为 `0` 时关闭自动清理。状态 `EXPIRED` 表示正文已清理，具备下载权限的用户可以从 TDLib 文件记录重新下载。

仍需用户本人进行的外部验收：真实 TDLib 登录与加密会话重启恢复、真实 @jisou 回复格式/下一页交互、真实可访问频道的历史采集及媒体下载。自动化验收只使用模拟 Telegram 客户端和一次性隔离数据库，不会登录真实账号、联系机器人、加入频道或下载外部内容。@jisou 回复结构是未固定协议；系统保留原始消息并谨慎显示候选解析，不能保证所有回复格式都能归一化。RAR/7z 受运行时 7-Zip 解码能力约束；本次运行会用生成的无害测试归档检查 CLI 参数与提取路径，但若未提供真实 RAR 样例，不把所有商业 RAR 变体都称为已验证。模块不承诺 Telegram 服务端提供实时推送。

## 服务端配置

通过操作系统环境变量、受保护的部署密钥或项目现有配置注入机制提供以下配置；不要将真实值写入前端、提交到 Git 或粘贴到聊天中：

- `MODULE_TELEGRAM_ENABLED`：默认 `false`。确认凭据、密钥、持久目录和网络策略后才启用；沿用项目模块开关，重启生效。
- `TELEGRAM_API_ID`、`TELEGRAM_API_HASH`：Telegram 应用凭据。
- `TELEGRAM_SESSION_ENCRYPTION_KEY`：TDLib 本地数据库加密密钥，使用至少 32 个随机字节的 Base64 值并单独备份。
- `TELEGRAM_DATA_DIR`：受限访问的持久目录，默认 `./data/telegram`。该目录保存可恢复的账号会话，应使用受控操作系统账户和加密磁盘/备份。
- `TELEGRAM_SEARCH_BOT_USERNAME`：服务端允许联系的机器人用户名；必须由 Telegram 端验证为机器人后才允许查询。
- `TELEGRAM_PROXY_ENABLED`、`TELEGRAM_PROXY_TYPE`、`TELEGRAM_PROXY_HOST`、`TELEGRAM_PROXY_PORT`：Telegram TDLib 专用网络代理，默认关闭，支持 `socks5`、`http`、`mtproto`。代理认证由 `TELEGRAM_PROXY_USERNAME` / `TELEGRAM_PROXY_PASSWORD`（SOCKS5/HTTP）或 `TELEGRAM_PROXY_SECRET`（MTProto）注入。启用后会先由 TDLib 添加并启用代理，再提交账号参数；不使用 JVM、Maven、Git 或浏览器代理设置。状态页只显示协议和配置有效性，不回显地址或认证信息。
- `TELEGRAM_MAX_MEDIA_FILE_BYTES`：单附件下载上限，默认 50 MiB，允许范围 1–512 MiB。
- `TELEGRAM_MAX_STORED_MEDIA_BYTES`：已存正文与在途下载预留的模块上限，默认 10 GiB，允许范围 100 MiB–2 TiB。
- `TELEGRAM_MINIMUM_FREE_DISK_BYTES`：下载前必须保留的可用空间，默认 1 GiB。
- `TELEGRAM_MAX_MEDIA_WORKERS`：并发下载数，默认 2，允许范围 1–8。
- `TELEGRAM_MEDIA_DOWNLOAD_TIMEOUT_SECONDS`：单个 TDLib 附件下载超时，默认 600 秒，允许范围 30–3600 秒。
- `TELEGRAM_MEDIA_RETENTION_DAYS`：已下载正文保留天数，默认 90；`0` 禁用自动清理，最大 3650 天。
- `TELEGRAM_7ZIP_PATH`、`TELEGRAM_FFMPEG_PATH`、`TELEGRAM_FFPROBE_PATH`：归档/视频工具的可信服务端路径；默认分别为 `7z`、`ffmpeg`、`ffprobe`。生产 Docker 镜像自带对应 Linux 包，普通业务 API 不能修改可执行路径。状态页检查工具文件是否存在且具备执行权限，不会运行探测命令，也不返回服务器路径。
- `TELEGRAM_MAX_PREVIEW_OUTPUT_BYTES`：每个视频预览的 HLS 分片总量上限，默认 1 GiB，配置范围 16 MiB–4 GiB。
- `TELEGRAM_MAX_PREVIEW_DURATION_SECONDS`：单视频允许处理的最长时长，默认 7,200 秒。
- `TELEGRAM_PREVIEW_TIMEOUT_SECONDS`：单次 FFprobe/FFmpeg 处理总时限，默认 1,800 秒。

Windows PowerShell 可用系统密码管理器或随机数生成器生成密钥；输出仅在本机安全保存：

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
[Array]::Clear($bytes, 0, $bytes.Length)
```

不要让多个应用实例同时打开同一 TDLib 会话目录。共享部署需要单实例调度和可靠文件锁策略。Linux 原生库依赖及 Windows VC++ 运行库要求以锁定的 TDLight 发行版说明为准；缺少运行库时不得因此影响模块关闭状态下的主应用启动。

## 授权与权限

在后台角色权限中按需授予 `telegram:view`、`telegram:connect`、`telegram:disconnect`、`telegram:logout`、`telegram:search`、`telegram:collect`、`telegram:download`。普通用户不会自动获得这些权限。账号所有者、平台管理员或具备显式全量权限的用户可管理账号；业务记录仍受所有权及现有部门/数据范围限制。下载任务入队时和实际取件时都会复核权限，媒体每次读取都会重新校验。`logout` 会远端退出并清除本机授权，必须与普通断开连接权限分开授予。

页面上的连接动作会根据 Telegram 要求提交手机号、验证码、两步验证密码或注册姓名。验证码和密码只在当前请求中使用，不写入业务表或浏览器持久状态。普通断开会保留加密会话以供恢复；退出账号会注销 Telegram 授权并删除本地会话。

## 运行和数据库

- 空库可导入单一脚本 `database/mayday.sql`（当前基线 V47，77 张业务表、781 个含注释字段），已有数据库使用 Flyway 增量升级 V35–V47；不得修改已执行迁移。
- Telegram 业务表、索引、外键和每列中文注释应同时存在于迁移与统一 SQL 中。运行 `node scripts/database-docs.mjs --check` 验证结构注释。
- 新增 Mapper 位于 `backend/mayday-telegram`，使用本地 MyBatis-Flex Starter；Telegram 不新增 JPA/Hibernate 数据访问。
- 查看环境状态：打开后台“Telegram”。模块关闭或配置不完整时，不会自动尝试登录、发送消息或联网搜索。
- Java 业务代码可以直接注入 `TelegramSearchService`、`TelegramCollectionService` 等服务；不得通过 HTTP 回调本机应用。

## 自动化验收历史记录

本节保留阶段性记录；各阶段记录只代表当时范围。最新代码的构建、数据库和运行期结果，以[开发计划文末的最终复验记录](telegram-development-plan.md#最终自动化复验与交付边界)为准。

- Java 21 全后端 Maven Reactor 在 V44 时最近一次完整验收：12 个模块 Spotless、编译和测试成功；主应用测试 129 项、0 失败、12 项因已有集成环境条件跳过；Telegram 子模块 ZIP 验收后为 28 项通过。本轮取消联动新增 3 项回归后，Telegram 子模块 31 项测试通过。
- 前端 `npm run build` 通过；`npm run test:ui` 通过 236 项，0 失败、2 项按现有 Java 发布校验条件跳过。
- V44 阶段的数据库计数为 74 张表、741 个字段；这些历史结果不代表当前 V47 结构。
- V44 阶段未能在隔离数据库执行最新迁移或导出完整契约；当前 V47 运行期验收状态以开发计划文末最新记录为准。
- 真实 TDLib 登录、真实账号重启恢复、真实 @jisou 搜索和频道采集均未执行。代码构建/模拟测试通过不代表真实 Telegram 联调通过。

详细阶段记录、已知失败及剩余范围见[Telegram 开发计划](telegram-development-plan.md)。

## 自动保留清理补充（2026-10-22）

- Telegram 媒体只在 `AVAILABLE` 且超过配置期限后进入 `DELETING`；下载中的附件不会被保留任务删除。数据库锁与 10 分钟租约允许多实例并行处理不同文件，并在进程中断后接管清理。
- 清理线程每分钟轮询一次，每轮最多处理 20 个附件。存储删除成功后才把状态改为 `EXPIRED` 并清空存储引用和播放票据；存储失败时保留租约到期后的重试机会，不误报清理完成。存储配额在正文删除成功前仍计入 `DELETING` 对象。
- 到期的 `EXPIRED` 附件仍保留来源消息和描述信息；有下载权限的用户可重新下载，过期清理不会消耗正常失败重试次数。
- 数据库增量脚本为 V44，空库交付脚本同步为 V44；页面把清理中/已清理状态清楚显示出来。
- 此项最终 Java、隔离数据库、统一 SQL 和前端自动化验收通过。逐项结果与尚未完成的真实 Telegram 外部联调/产品边界见[Telegram 开发计划的最终复验记录](telegram-development-plan.md#最终自动化复验与交付边界)。

## V45–V47 频道与视频能力补充

- V45 增加可访问频道来源和包含式日期过滤；V47 在已完成、无结束日期的频道任务上增加显式定期拉取。它每 30 秒最多领取一页（最多 100 条），最多检查 10,000 条后停止；关闭/权限撤回时停止，原历史回填游标不受影响。为追赶被拆页的消息积压，TDLib 返回倒序消息后按 ID 顺序提交并保存游标。定期拉取不是 push，也不能保证时间上实时或无遗漏。
- V46 增加持久化 HLS 点播预览队列、输出配额预留、工作租约、权限保护的清单/分片接口及到期清理；视频先经 FFprobe 检查格式、时长和尺寸，再选择直接封装或限制分辨率/像素格式的转码。前端通过 HLS.js 的带 Bearer 请求读取播放列表和分片；普通 MP4/WebM 可回退到十分钟短期票据流。
- V47 增加 RAR/7z 目录浏览和单条提取。ZIP 使用 Java 读取；RAR/7z 在最终 Linux 镜像使用 `7z` 进程，固定参数、禁止 shell 拼接、按大小与时间上限执行；仅可按目录项点选提取，不支持加密、分卷和递归。
- V47 结构在最新验收记录中核实，包含 77 张表、781 个字段；迁移和统一基线均有详细中文列注释。历史 V44 计数见上节旧验收记录。
- iOS Safari 的 MSE/HLS 支持因系统版本和具体编码存在差异；浏览器若不支持 HLS.js/MSE，会显示短期授权的原视频播放链接。自动化以模拟用户和合成媒体验证，不覆盖真实 iOS 设备。
