package com.mayday.content;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 首页配置的乐观版本与栏目、文章版本分开，不因修改主题覆盖其他人的内容编排。 */
public interface PortalHomeRepository extends JpaRepository<PortalHome, Long> {
  /** 配置写入统一锁定单例，阻止并发将同一分类分配到不同栏目；不会修改首页编排版本。 */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select h from PortalHome h where h.id = 1")
  Optional<PortalHome> lockConfiguration();
}
