package com.mayday.system.repository;

import com.mayday.system.model.LoginSession;
import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;

/** 修改密码、停用账号时清除此账号所有令牌。 */
public interface SessionRepository extends JpaRepository<LoginSession, String> {
  /** 在调用方事务中撤销账号全部会话；修改密码和停用操作应与此删除一起提交。 */
  void deleteByUserId(Long userId);

  /** 清理固定有效期已经结束的摘要；不会延长仍有效会话的登录期限。 */
  void deleteByExpiresAtBefore(Instant now);
}
