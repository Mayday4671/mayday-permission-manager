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

    private String name;

    private String code;

    private String value;

    private String description;

    /** 菜单可见性所需动作键；菜单配置只影响导航展示，不替代接口实际授权。 */
    private String permission;

    /** 后台已注册的内部路由；保存时由服务端目录校验，不能传入任意外链或脚本。 */
    private String path;

    /** 仅树形资源使用的父节点；服务层拒绝跨类型父级、自指向和层级循环。 */
    private Long parentId;

    /** 仅部门使用负责人，组织变动与流程解析后续共同读取此稳定账号 ID。 */
    private Long leaderId;

    private String icon;

    private String groupName = "通用";

    private String valueType = "TEXT";

    /** 内置资料的删除与关键值修改由服务层保护，不能只凭前端隐藏按钮。 */
    private boolean builtIn;

    private int sortOrder;

    private boolean enabled = true;
}
