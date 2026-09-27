package com.mayday.operations.repository;

import com.mayday.operations.model.FlowTask;
import java.util.*;
import org.springframework.data.jpa.repository.*;

public interface FlowTaskRepository
    extends JpaRepository<FlowTask, Long>, JpaSpecificationExecutor<FlowTask> {
  List<FlowTask> findByRequestIdOrderByIdAsc(Long requestId);

  boolean existsByRequestIdAndAssigneeId(Long requestId, Long assigneeId);

  void deleteByRequestId(Long requestId);
}
