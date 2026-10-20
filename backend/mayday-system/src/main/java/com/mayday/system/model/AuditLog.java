package com.mayday.system.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 只记录操作元数据，不记录请求正文和凭证，兼顾审计与敏感信息保护。 */
@Getter
@Setter
@Table(value = "sys_audit_log", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class AuditLog extends BaseEntity
{

    /** 认证账号或 anonymous；登录失败时是请求者声称的用户名，不代表该账号已认证操作 */
    private String username;

    /** HTTP 请求方法，例如 GET/POST/PUT/DELETE */
    private String method;

    /** 只保存不含查询参数的路径，防止搜索内容或历史系统的 URL 凭证进入审计。 */
    private String path;

    /** 记录最终 HTTP 状态，业务拒绝和失败同样保留；不存异常正文。 */
    private int status;

    /** 请求处理耗时，单位毫秒；不含后续日志持久化时间 */
    private long durationMs;

    /** 请求来源地址；默认连接对端地址，不能信任任意客户端转发头 */
    private String ip;
}
