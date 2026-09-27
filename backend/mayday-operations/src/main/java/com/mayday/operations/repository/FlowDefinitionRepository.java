package com.mayday.operations.repository;

import com.mayday.operations.model.FlowDefinition;
import org.springframework.data.jpa.repository.*;

/** 顺序审批模板；实例提交时复制审批人顺序，模板后续调整不会改变已有实例。 数据访问层。 */
public interface FlowDefinitionRepository
    extends JpaRepository<FlowDefinition, Long>, JpaSpecificationExecutor<FlowDefinition> {
  @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @Query("select d from FlowDefinition d where d.id=:id")
  java.util.Optional<FlowDefinition> lockById(Long id);

  boolean existsByCategoryId(Long id);
}
