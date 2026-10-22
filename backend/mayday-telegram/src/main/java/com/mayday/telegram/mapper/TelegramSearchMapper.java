package com.mayday.telegram.mapper;

import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramSearch;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** MyBatis-Flex mapper for user-owned Telegram search records. */
@Mapper
public interface TelegramSearchMapper extends EntityMapper<TelegramSearch>
{
    /**
     * Finds the outgoing request whose chat/message pair is explicitly referenced
     * by a bot reply.
     */
    default Optional<TelegramSearch> findBySentMessage(String chatId, String messageId)
    {
        return Optional
                .ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("bot_chat_id").eq(chatId))
                        .and(new QueryColumn("sent_message_id").eq(messageId))));
    }
}
