package com.mayday.operations.repository;

import com.mayday.operations.model.FlowDefinition;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 定义草稿写入使用行锁；发布版本和历史实例由各自仓储保存，不能覆盖历史快照。 */
public interface FlowDefinitionRepository
    extends JpaRepository<FlowDefinition, Long>, JpaSpecificationExecutor<FlowDefinition> {
  @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @Query("select d from FlowDefinition d where d.id=:id")
  java.util.Optional<FlowDefinition> lockById(Long id);

  boolean existsByCategoryId(Long id);
}
