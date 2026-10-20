package com.mayday.system.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 与业务事务共同提交的关键变更轨迹；仅保存调用方白名单字段，不存请求正文或凭据。 */
@Getter
@Setter
@Table(value = "sys_change_audit", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class ChangeAudit extends BaseEntity
{

    /** 有效会话中的操作账号名；后台定时维护使用system，不来自客户端 */
    private String actor;

    /** 变更对象类型的可读名称，例如用户、角色、内容 */
    private String resource;

    /** 原业务记录ID；业务删除后仍保留编号，不设置级联删除外键 */
    private Long resourceId;

    /** 业务动作的可读名称，例如调整角色授权或直接发布 */
    private String action;

    /** 保存服务层白名单字段的前后差异 JSON；密码、会话凭证及正文不参与差异计算。 */
    private String changesJson;
}
