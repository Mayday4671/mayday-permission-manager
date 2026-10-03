# 主题配置

后台右上角“后台主题”通过右侧抽屉配置个人偏好，调整时整页即时预览。保存后写入本浏览器的 `mayday.admin.appearance.v1`，取消、关闭、路由切换或卸载时恢复已保存值。该偏好不按账号跨设备同步。抽屉桌面宽度 480 px，小屏使用可用宽度，保存/取消固定在底部；其他业务编辑继续使用居中弹窗。

门户使用已确认的蓝白浅色与海军蓝暗夜阅读布局，前后台互相独立。内容管理 → 门户栏目 → 前台主题包含“访客主题策略”和“前台默认主题”；网站配置也保留默认主题编辑入口。主题编辑使用右侧抽屉，效果预览只影响草稿，保存后写入真实 Java/MySQL 配置。

## 后台个人主题

- “主题风格”：浅色、深色、跟随系统；五组图示预设；七种常用主色和自定义 HEX。预设改变主色、菜单风格、背景、容器、圆角与图表色板，保留当前明暗、宽度、密度和状态色。
- “布局外观”：浅色、深色或带主题色的菜单；四种背景；边框或阴影；圆角与紧凑布局；铺满或最大 1600 px 居中。默认铺满，后台继续使用单侧菜单和标签页。
- “图表与状态”：品牌色、明快、柔和三组六色图表色板；独立成功、警告和错误色。图表统一使用 `--app-chart-1` 至 `--app-chart-6`，业务状态读取 Ant 派生 Token。
- “复制配置”：复制完整 JSON；“导入配置”：先校验再写入草稿，仍需保存。未知字段、CSS、URL、错误类型或越界数字拒绝导入。“恢复默认”恢复当前编辑范围的默认值。

## 门户默认主题与访客策略

前台默认主题保存至 `sys_entry` 的 `site.theme`，单独提交 `value/version`，使用 `settings:view/update`。门户编辑器只显示默认明暗与浅色主色及颜色预设；效果预览使用同一阅读配色和本地实图，不显示门户没有使用的后台菜单、图表色板或容器布局选项。浅色背景、暗夜背景、阅读间距与宽度遵循本次设计，随窗口调整。

`cms_portal_home` 独立保存 `allowThemeToggle` 与 `nightPrimaryColor`，编辑需要 `portal:view/update`，通过 `/portal-management/theme-policy` 只修改主题策略。使用与首页相同的版本锁，避免并发覆盖；已有精选文章下线不会阻止主题策略保存。暗夜强调色必须是六位 HEX，默认 `#53d5be`。

允许访客切换时，顶栏提供太阳/月亮按钮，仅保存本浏览器 `mayday.portal.mode.v1` 的 light/dark 偏好，不改变公共主题。关闭切换时严格使用后台保存的默认明暗策略，旧访客偏好不再生效。门户没有后台入口或全站主题编辑入口。已打开的页面约每 30 秒取得公共配置更新；访客偏好不承诺跨设备或跨标签页同步。

只读账号不能保存；版本过期返回 409，失败保留草稿。普通站点文字编辑不包含主题键，后台个人主题取消也不会撤销已保存的公共站点配置。

## 配置契约与兼容

`site.theme` 的既有基础及扩展字段继续由 `PortalThemePolicy` 严格校验，旧配置缺省项逐项补默认值，非法遗留配置安全回退。读取不自动改写数据库原值。为兼容旧客户端，以下布局字段仍接受和保存；本次门户固定阅读布局不消费后台的 menuStyle/background/surfaceStyle/contentWidth/compact/borderRadius，前台编辑器不提供这些无效操作。后台个人主题仍完整使用它们。

- `mode`：`light/dark/system`，必填；跟随系统监听操作系统明暗变化。
- `primaryColor`：必填，六位 `#RRGGBB`，规范化为小写；门户用作浅色主色。
- `borderRadius`：必填，整数 0–16，px；`compact`：必填布尔值。
- `menuStyle`：`light/dark/tinted`，默认 `light`；`background`：`neutral/slate/blue/warm`，默认 `neutral`。
- `surfaceStyle`：`border/shadow`，默认 `border`；`contentWidth`：`full/boxed`，默认 `full`。
- `chartPalette`：`brand/vivid/soft`，默认 `brand`；品牌色首色随主色变化。
- `successColor/warningColor/errorColor`：六位 HEX，分别默认 `#52c41a/#faad14/#ff4d4f`。显式错误值返回 400，不静默替换。

## 二次开发

`theme-model.ts` 管理配置、预设、导入与色板；`theme.tsx` 使用 Ant 算法派生组件和 HTML 的统一 Token，门户额外使用固定阅读底色及独立暗夜强调色。`appearance-context.ts` 分开管理后台预览和门户访客状态；`ThemeEditor` 共用受控选择器、抽屉、配置导入和预览。

业务样式读取 `--app-surface/--app-layout/--app-text/--app-border` 等语义变量，表格、滚动条、弹窗与焦点继续跟随当前主题。门户新页面优先复用 `portal.css` 的阅读组件，不能从后台个人偏好生成公共导航或页面结构。

新增配置必须同步前端类型、规范化、后端白名单/约束、真实接口和组件测试。访客策略属于 `PortalStructureService.ThemePolicyDraft`，公共默认主题属于 `PortalThemePolicy`；通用参数接口同样经过后者校验，不能绕过网站配置限制。

后台设置面板参考 [Art Design Pro 公开实现](https://github.com/Daymychen/art-design-pro/tree/main/src/components/core/layouts/art-settings-panel)及[官方主题说明](https://www.artd.pro/docs/zh/pro/frontend/ui/layout-theme.html)，使用本项目 React/Ant Design 独立实现，没有迁入 Vue 或商业源码。任意自定义色不能自动保证可访问性对比度，品牌调整后应检查真实页面。门户用法与验收见 [门户指南](portal.md)及[本轮记录](portal-redesign-validation-20261003/README.md)。
