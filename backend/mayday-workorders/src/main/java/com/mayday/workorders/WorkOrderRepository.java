package com.mayday.workorders;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 查询使用 Specification 合并业务筛选与数据范围，在 SQL 层限制可见记录。 */
public interface WorkOrderRepository
    extends JpaRepository<WorkOrder, Long>, JpaSpecificationExecutor<WorkOrder> {}
