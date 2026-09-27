# 文档导航

新项目优先阅读 [复用与上线指南](reuse.md)，数据库交付统一为 [mayday.sql](../database/mayday.sql)，使用说明和完整字段注释均在 SQL 内。

- [项目说明和快速启动](../README.md)：技术栈、启动、常用验证命令。
- [复用与上线指南](reuse.md)：适用边界、纯净初始化、模块接入、配置和上线准备。
- [权限模型](permissions.md)：动作、数据范围、敏感字段、授权委托、会话、审计及审批边界。
- [架构与扩展](development.md)：Java 模块、公共 React 组件、主题、菜单页签和跨模块契约。
- [API 契约](api.md)：认证、分页、错误码及各业务入口；请求 DTO 以源码为准。
- [数据库初始化脚本](../database/mayday.sql)：空库安装、40 张业务表、373 个字段注释、索引/外键、必要基础资料及 V17 版本基线。
- [UDP 转发](udp-relay.md)：独立 Netty 模块、页面配置、实时统计、权限、部署及持续打流验收。
- [图片采集](image-crawler.md)：列表与详情分页配置、HTML/JSON 示例、任务、文件结果、权限和支持范围。
- [图片采集验收](crawler-validation-20260922/README.md)：数据库升级、权限回归、真实网络采集及未完成的页面验收。
- [升级与恢复](upgrade.md)：备份、隔离验收、本机升级及故障处理。
- [本轮复用验收](reuse-validation/README.md)：本轮结论、补齐内容、测试证据和未覆盖能力。
- [工作台待办与消息](work-notifications-validation/README.md)：审批到人、站内通知、首页入口、权限要求和最近验收记录。
- [后台查询与编辑体验](admin-usability-validation-20260922/README.md)：常用查询、表格偏好、离开保护、问题修复和本轮验证范围。

`p1-validation` 至 `p6-validation`、权限/主题/门户等 validation 文件夹是对应日期的验收记录，不能把旧结果自动视为对新代码的验证。当前功能与限制以以上指南和最近验收记录为准。截图、设计调研不替代接口权限测试。
