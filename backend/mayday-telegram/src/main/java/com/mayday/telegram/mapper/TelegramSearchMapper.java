package com.mayday.telegram.mapper;

import java.time.LocalDateTime;
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
     * Locks one search row while asynchronous Telegram updates compete to finish
     * the same request.
     */
    default Optional<TelegramSearch> lock(Long id)
    {
        return Optional
                .ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
    }

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

    /**
     * Finds the only unexpired search currently awaiting this bot. The service
     * enforces one in-flight search at a time, which safely supports bots that do
     * not set Telegram's reply-to message identifier.
     */
    default Optional<TelegramSearch> findActiveForBot(String chatId, LocalDateTime now)
    {
        return Optional.ofNullable(selectOneByQuery(QueryWrapper.create()
                .where(new QueryColumn("bot_chat_id").eq(chatId))
                .and(new QueryColumn("status").in("SENDING", "WAITING")).and(new QueryColumn("expires_at").gt(now))));
    }
}
