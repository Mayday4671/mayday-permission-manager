package com.mayday.system.repository;

import com.mayday.system.model.ChangeAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 变更日志独立查询；业务删除不会级联删除审计证据。 */
public interface ChangeAuditRepository
    extends JpaRepository<ChangeAudit, Long>, JpaSpecificationExecutor<ChangeAudit> {}
