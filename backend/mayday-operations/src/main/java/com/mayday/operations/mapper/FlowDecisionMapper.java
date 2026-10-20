package com.mayday.operations.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.FlowDecision;
import org.apache.ibatis.annotations.Mapper;

/** 审批历史只追加，申请人和审批参与人可查询。 */
@Mapper
public interface FlowDecisionMapper extends EntityMapper<FlowDecision> {}
