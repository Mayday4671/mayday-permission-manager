package com.mayday.system.model;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.Setter;

/**
 * 数据库仅保存随机令牌的 SHA-256 摘要；固定期限、撤销和账号状态由每次认证复核，列表不返回摘要。
 *
 * <p>会话不继承业务实体的乐观锁与审计监听：主键是调用方生成的令牌摘要，时间点由认证服务显式写入。
 */
@Getter
@Setter
@Table("sys_session")
public class LoginSession {
  /** 认证查找使用的摘要主键；不能进入公开 DTO、变更日志或前端存储。 */
  @Id(keyType = KeyType.None)
  private String tokenHash;

  /** 面向管理页面的独立会话标识，可用于强制下线；它不是可用于认证的令牌。 */
  private String sessionId;

  private Instant createdAt;

  /** 认证服务每分钟最多更新一次；按服务端无请求期限判断失效，不延长 expiresAt 的固定到期时间。 */
  private Instant lastActiveAt;

  private String ip;

  private String device;

  private Long userId;

  private Instant expiresAt;
}
