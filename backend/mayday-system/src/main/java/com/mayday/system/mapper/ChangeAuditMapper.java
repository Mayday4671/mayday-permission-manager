package com.mayday.system.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.system.model.ChangeAudit;
import org.apache.ibatis.annotations.Mapper;

/** 变更日志独立查询；业务删除不会级联删除审计证据。 */
@Mapper
public interface ChangeAuditMapper extends EntityMapper<ChangeAudit>
{
}
