package com.mayday.system.repository;

import com.mayday.system.model.LoginSession;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 修改密码、停用账号时清除此账号所有令牌。 */
public interface SessionRepository
    extends JpaRepository<LoginSession, String>, JpaSpecificationExecutor<LoginSession> {
  /** 仅载入目标账号的会话，用于账号行锁内的配额判断，创建时间相同仍按摘要稳定排序。 */
  List<LoginSession> findByUserIdOrderByCreatedAtAscTokenHashAsc(Long userId);

  /** 按公开 UUID 精确查找撤销目标；调用方仍须独立验证动作、范围及账号管理等级。 */
  Optional<LoginSession> findBySessionId(String sessionId);

  /** 在调用方事务中撤销账号全部会话；修改密码和停用操作应与此删除一起提交。 */
  void deleteByUserId(Long userId);

  /** 清理固定有效期已经结束的摘要；不会延长仍有效会话的登录期限。 */
  void deleteByExpiresAtBefore(Instant now);
}
