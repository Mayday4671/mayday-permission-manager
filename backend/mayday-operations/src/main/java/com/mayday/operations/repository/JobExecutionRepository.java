package com.mayday.operations.repository;

import com.mayday.operations.model.JobExecution;
import org.springframework.data.jpa.repository.*;

/** 执行历史独立留存，删除任务不会抹掉执行日志。 数据访问层。 */
public interface JobExecutionRepository
    extends JpaRepository<JobExecution, Long>, JpaSpecificationExecutor<JobExecution> {}
