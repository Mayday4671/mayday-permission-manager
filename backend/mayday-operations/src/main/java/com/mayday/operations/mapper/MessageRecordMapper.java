package com.mayday.operations.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.MessageRecord;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** 站内信按收件人独立保存已读状态；发件人与接收者均由服务端校验。 */
@Mapper
public interface MessageRecordMapper extends EntityMapper<MessageRecord>
{
    default long countByRecipientIdAndReadAtIsNull(Long recipientId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("recipient_id").eq(recipientId))
                .and(new QueryColumn("read_at").isNull()));
    }
}
