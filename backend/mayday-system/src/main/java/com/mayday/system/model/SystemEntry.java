package com.mayday.system.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 可复用的基础资料模型：部门、菜单、字典、参数共享生命周期，业务约束由服务层按 kind 执行。 */
@Getter
@Setter
@Table(value = "sys_entry", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class SystemEntry extends BaseEntity
{
    /** 资料类型属于服务端白名单，所有按主键操作都必须同时匹配类型，避免跨资源读取。 */
    private String kind;

    /** 业务显示名称；分类及标签由应用进一步限制为 32 字 */
    private String name;

    /** 同 kind 内唯一编码；settings 时为参数键，menus 时为已实现页面编码 */
    private String code;

    /** 通用配置值，最长 2000 字；settings 按 value_type 校验，字典旧汇总值仅作兼容，禁止存凭据 */
    private String value;

    /** 业务用途或参数含义说明；不作为可执行表达式使用 */
    private String description;

    /** 菜单可见性所需动作键；菜单配置只影响导航展示，不替代接口实际授权。 */
    private String permission;

    /** 后台已注册的内部路由；保存时由服务端目录校验，不能传入任意外链或脚本。 */
    private String path;

    /** 仅树形资源使用的父节点；服务层拒绝跨类型父级、自指向和层级循环。 */
    private Long parentId;

    /** 仅部门使用负责人，组织变动与流程解析后续共同读取此稳定账号 ID。 */
    private Long leaderId;

    /** 已登记的菜单图标编码；不是 HTML/SVG 源代码 */
    private String icon;

    /** 系统参数展示分组；默认通用，仅为分类信息，不授予任何权限 */
    private String groupName = "通用";

    /** 参数类型：TEXT/NUMBER/BOOLEAN/EMAIL/JSON；决定 value 的校验方式，不接受任意类型名 */
    private String valueType = "TEXT";

    /** 内置资料的删除与关键值修改由服务层保护，不能只凭前端隐藏按钮。 */
    private boolean builtIn;

    /** 显示排序值；升序，同值再按主键排序 */
    private int sortOrder;

    /** 启用标记：1 启用、0 停用；不等于物理删除，停用的实际影响由所属模块校验 */
    private boolean enabled = true;
}
