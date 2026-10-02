# 主题配置

后台右上角“后台主题”通过右侧抽屉配置个人偏好，调整时整页即时预览。保存后写入本浏览器的 `mayday.admin.appearance.v1`，取消、关闭、路由切换或卸载时恢复已保存值。该偏好不按账号跨设备同步。抽屉桌面宽度 480 px，小屏使用可用宽度，保存/取消固定在底部；其他业务编辑继续使用居中弹窗。

系统管理 → 网站配置 → 前台主题单独保存公共网站主题。使用同一右侧抽屉，在“效果预览”标签查看草稿，不影响后台或在线门户；保存通过真实 Java 接口写入 MySQL，使用 `settings:update` 权限和原版本号。只读账号不能保存，过期版本返回 409，失败保留草稿。已打开的门户按原有 30 秒轮询获取新配置。前台不暴露后台入口和个人主题开关。

## 操作

- “主题风格”：浅色、深色、跟随系统；五组图示预设；七种常用主色和自定义 HEX。预设改变主色、菜单风格、背景、容器、圆角与图表色板，保留当前明暗、宽度、密度和状态色。
- “布局外观”：浅色、深色或带主题色的导航；四种页面背景；边框或阴影；圆角与紧凑布局；铺满或最大 1600 px 居中。默认铺满，不增加宽屏两侧空白。后台继续使用现有单侧菜单和标签页。
- “图表与状态”：品牌色、明快、柔和三组六色图表色板；独立成功、警告和错误色。操作统计使用色板首色；新增图表统一使用 `--app-chart-1` 至 `--app-chart-6`，业务状态消费 Ant 派生 Token。
- “复制配置”：复制完整 JSON；“导入配置”：先校验再写入草稿，仍需保存。未知字段、CSS、URL、错误类型或越界数字拒绝导入。“恢复默认”恢复当前后台或门户的独立默认值。

## 配置契约与兼容

`site.theme` 复用 `sys_entry` 的 JSON 参数，单独提交 `value/version`，不新增表，不重写历史 Flyway 迁移。已有四字段配置继续有效，新增项逐项补默认值；损坏的浏览器偏好和非法历史公共配置安全回退。数据库参数原值不在读取时自动重写。

字段定义：

- `mode`：`light/dark/system`，必填。跟随系统监听访客操作系统明暗变化。
- `primaryColor`：必填，六位 `#RRGGBB`，返回时统一小写。
- `borderRadius`：必填，整数 0–16，单位 px；`compact`：必填布尔值。
- `menuStyle`：`light/dark/tinted`，默认 `light`；门户用于顶部导航。
- `background`：`neutral/slate/blue/warm`，默认 `neutral`。配置不接受背景 URL 或自由 CSS。
- `surfaceStyle`：`border/shadow`，默认 `border`；`contentWidth`：`full/boxed`，默认 `full`。
- `chartPalette`：`brand/vivid/soft`，默认 `brand`；品牌色模式首色随主色变化。
- `successColor/warningColor/errorColor`：六位 HEX，分别默认 `#52c41a/#faad14/#ff4d4f`。必填或显式新增字段的错误值返回 400，不能静默变成默认值。

## 二次开发

`frontend/src/lib/theme-model.ts` 管理纯配置、预设、兼容、导入校验和色板；`theme.tsx` 用 Ant Design 算法派生组件与 HTML 的统一 Token；`appearance-context.ts` 区分已保存值和内存预览。`ThemeEditor` 提供前后台共用的受控选择器、预览和配置操作。

业务样式使用 `--app-surface/--app-layout/--app-text/--app-border` 等语义变量，容器使用 `--app-panel-border/--app-panel-shadow`；不要硬编码亮色背景。导航变量限定在导航范围，表格、滚动条、弹窗与主内容继续读取全局主题。

后端 `PortalThemePolicy` 是唯一公共契约。新增字段必须同时修改前端类型、规范化/导入、后端白名单/类型/枚举及对应边界测试，不能只在页面多加一个颜色输入框。通用系统参数接口也调用同一策略，不能绕过网站配置校验。

本次参考 [Art Design Pro 的设置面板公开实现](https://github.com/Daymychen/art-design-pro/tree/main/src/components/core/layouts/art-settings-panel)与[官方布局和主题说明](https://www.artd.pro/docs/zh/pro/frontend/ui/layout-theme.html)，使用本项目 React 与 Ant Design 独立实现。没有迁入它的 Vue 代码或商业源码。任意自定义颜色并不保证所有组合都满足可访问性对比要求；交付时仍应检查实际品牌色。
