package com.mayday.operations.repository;

import com.mayday.operations.model.FlowDecision;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 审批历史只追加，申请人和审批参与人可查询。 数据访问层。 */
public interface FlowDecisionRepository
    extends JpaRepository<FlowDecision, Long>, JpaSpecificationExecutor<FlowDecision> {}
