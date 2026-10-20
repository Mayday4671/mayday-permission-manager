package com.mayday.system.model;

import java.time.Instant;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 数据库仅保存随机令牌的 SHA-256 摘要；固定期限、撤销和账号状态由每次认证复核，列表不返回摘要。
 *
 * <p>
 * 会话不继承业务实体的乐观锁与审计监听：主键是调用方生成的令牌摘要，时间点由认证服务显式写入。
 */
@Getter
@Setter
@Table("sys_session")
public class LoginSession
{
    /** 认证查找使用的摘要主键；不能进入公开 DTO、变更日志或前端存储。 */
    @Id(keyType = KeyType.None)
    private String tokenHash;

    /** 面向管理页面的独立会话标识，可用于强制下线；它不是可用于认证的令牌。 */
    private String sessionId;

    /** 会话签发时间点；固定期限亦按当前策略从此时刻计算，缺少可信签发时间的记录不能恢复认证 */
    private Instant createdAt;

    /** 认证服务每分钟最多更新一次；按服务端无请求期限判断失效，不延长 expiresAt 的固定到期时间。 */
    private Instant lastActiveAt;

    /** 登录请求来源地址；默认取连接对端，可信代理部署需要另行配置 */
    private String ip;

    /** 登录请求 User-Agent 截断至 255 字符；客户端声明信息，不能用于鉴权 */
    private String device;

    /** 会话账号 ID，外键 sys_user.id；鉴权时重新加载账号状态和角色 */
    private Long userId;

    /** 签发时的固定截止时间，TIMESTAMP 时间点；按会话配置写入，默认 720 分钟，不随认证活动延长 */
    private Instant expiresAt;
}
