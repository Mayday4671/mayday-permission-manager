package com.mayday.operations.repository;

import com.mayday.operations.model.FlowVersion;
import java.util.*;
import org.springframework.data.jpa.repository.*;

public interface FlowVersionRepository extends JpaRepository<FlowVersion, Long> {
  List<FlowVersion> findByDefinitionIdOrderByVersionNumberDesc(Long definitionId);
}
