package com.mayday.telegram.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramConversation;
import org.apache.ibatis.annotations.Mapper;

/**
 * Data-access boundary for Mayday's owner-scoped Telegram conversation groups.
 */
@Mapper
public interface TelegramConversationMapper extends EntityMapper<TelegramConversation>
{
}
