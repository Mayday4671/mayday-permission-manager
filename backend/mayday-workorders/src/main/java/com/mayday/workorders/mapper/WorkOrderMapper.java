package com.mayday.workorders.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.workorders.WorkOrder;
import org.apache.ibatis.annotations.Mapper;

/** 查询在应用层组合业务筛选与数据范围条件，由 SQL 层限制可见记录。 */
@Mapper
public interface WorkOrderMapper extends EntityMapper<WorkOrder> {}
