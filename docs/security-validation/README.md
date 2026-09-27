# 后台权限检查与修复验收

日期：2026-09-21。结论：确认并修复 3 类后端授权漏洞，修复已更新至本机运行的后端。

本轮围绕实际 Java 接口执行代码审查和 HTTP 越权验证。使用独立 MySQL 数据库、独立后端和临时账号复现，未在日常库创建测试角色、用户或业务记录。

## 1. 会话管理未执行用户数据范围（P1）

前提：账号具有 `sessions:view`，强制下线另需 `sessions:revoke`。原实现返回全局有效会话，包含其他账号的用户名、昵称、IP、设备和会话 UUID；撤销仅检查角色管理权限，缺少用户数据范围校验。

复现：本人范围操作员能列出其他部门的同权限账号会话，直接以该 UUID 请求撤销得到 HTTP 200。此问题不代表可获得他人的登录令牌，但能泄露会话信息并强制他人下线。

修复：本人会话允许自助管理；其他账号必须具有 `users:view` 且满足实时用户数据范围。列表先过滤再搜索、计数和分页。撤销同时校验范围和目标角色管理边界；所属账号缺失时拒绝操作。

验证：本人、本部门、指定部门与多角色组合均受限；范围外 UUID 撤销返回 403，目标会话保持有效；合法范围内撤销有效；低权限账号不能撤销管理员会话；收紧权限在已有会话下一次请求时生效。

代码：[SessionController.java](../../backend/mayday-operations/src/main/java/com/mayday/operations/web/SessionController.java)、[AccessPolicy.java](../../backend/mayday-security/src/main/java/com/mayday/security/AccessPolicy.java)。

## 2. 流程模拟和模型人员回显泄露范围外账号（P2）

前提：持有流程查看权限，可以提交模拟模型；新增草稿还需流程创建权限。原模拟只检查模拟发起人的范围，未检查解析后的审批人。模型回显也直接根据客户端提供的人员 ID 查询用户名和昵称。

复现：本人范围设计者将其他部门人员 ID 或角色 ID 放入模拟模型，接口返回范围外审批人的 ID 和姓名；保存草稿时还能获得对应用户名。该问题未授予对方的账号权限，但绕过了受限通讯录。

修复：人员回显复用统一用户可见性策略。模拟必须具备用户查看权限，并在指定人员、角色和部门负责人解析后逐一检查范围。任一审批人越界则整次返回 403，避免给出被截断的错误预览。

已发布流程的实际执行继续遵循业务授权和冻结的审批人员，不因申请人只能查看本人而截断审批链。流程定义管理权限仍是全局模型管理权限，不等于用户全量查看权。

验证：三种审批人来源的越权模拟、无用户查看权的模拟均被拒绝；草稿和详情不回显范围外账号名称；管理员正常模拟仍返回完整路径；实际审批、附件、字段、转交和加签原有回归通过。

代码：[WorkflowController.java](../../backend/mayday-operations/src/main/java/com/mayday/operations/web/WorkflowController.java)、[WorkflowDefinitions.java](../../backend/mayday-operations/src/main/java/com/mayday/operations/workflow/WorkflowDefinitions.java)。

## 3. 工作台绕过登录日志独立授权（P2）

前提：具有 `dashboard:view` 和 `logs:view`，但没有 `loginlogs:view`。原工作台使用未分类的审计查询，最近操作和趋势中混入登录日志。

复现：登录日志接口返回 403，但工作台响应仍包含登录日志中的账号、来源 IP 和结果。

修复：工作台的操作趋势与最近操作复用操作日志分类条件，只查询操作日志。

验证：操作日志查看者的工作台不含登录记录，趋势计数与操作日志接口一致；仅有工作台权限的账号不返回日志、趋势或未经授权的资源数量。

代码：[DashboardController.java](../../backend/mayday-application/src/main/java/com/mayday/web/DashboardController.java)、[AuditQueryService.java](../../backend/mayday-application/src/main/java/com/mayday/service/AuditQueryService.java)。

## 验证证据

- [修复前复现记录](before.log)：9 个失败子用例对应上述 3 类漏洞，基线为修复前正在运行的后端镜像。
- [完整接口回归记录](regression.log)：原有 50 个业务子用例与最初 14 个专项子用例通过；测试框架共计 67 项，包含 3 个父分组。
- [最终权限专项记录](security-regression.log)：扩展至 18 个专项子用例，全部通过；测试框架共计 19 项，包含 1 个父分组。
- [后端构建记录](build.log)：Java 多模块构建成功，5 项单元测试通过。
- [本机更新记录](deployment.json)：复用已验收镜像；旧镜像与完整数据库备份已保留；账号、角色授权、组织、内容及流程模型快照一致；数据库迁移版本未改变。

新增 [security.test.mjs](../../tests/security.test.mjs) 已接入 [verify-baseline.mjs](../../scripts/verify-baseline.mjs) 的空库和升级库验收流程，按顺序执行以保证日志计数检查稳定。专项测试要求独立 Compose 项目标识与数据库名称，不对日常数据库自动运行。

原有回归涵盖：匿名与伪造令牌、用户范围及导出、联系方式字段、角色委托和自我提权、账号停用与密码重置后的撤权、跨资源 ID、通知收件与附件、审批参与人/节点/字段/历史/附件、内容修订审核与发布、公开配置白名单及排期撤权。本机更新后另行检查门户读取、匿名拦截、管理员登录、工作台和退出，均通过。

## 适用范围

此次完成的是业务权限代码审查与本机真实接口验证，不是对整个部署环境的安全认证；未执行依赖漏洞扫描、公网渗透、分布式压力攻击或多实例验证。现有单实例登录限流与代理来源地址的部署约束见 [权限设计](../permissions.md)。

P1/P2 是本项目修复优先级，不是 CVSS 评分。本轮没有发现其他可复现的业务权限绕过，测试通过不构成对未知漏洞的保证。
