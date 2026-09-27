package com.mayday.system.repository;

import com.mayday.system.model.LoginSession;
import java.time.Instant;
import org.springframework.data.jpa.repository.JpaRepository;

/** 修改密码、停用账号时清除此账号所有令牌。 */
public interface SessionRepository extends JpaRepository<LoginSession, String> {
  void deleteByUserId(Long userId);

  void deleteByExpiresAtBefore(Instant now);
}
