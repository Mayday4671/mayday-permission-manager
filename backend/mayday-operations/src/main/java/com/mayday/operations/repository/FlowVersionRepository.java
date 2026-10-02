package com.mayday.operations.repository;

import com.mayday.operations.model.FlowVersion;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** 发布版本只追加不覆盖，编号由定义锁下产生，历史申请始终引用原版本。 */
public interface FlowVersionRepository extends JpaRepository<FlowVersion, Long> {
  List<FlowVersion> findByDefinitionIdOrderByVersionNumberDesc(Long definitionId);
}
