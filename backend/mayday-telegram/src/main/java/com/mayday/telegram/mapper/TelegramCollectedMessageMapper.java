package com.mayday.telegram.mapper;

import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramCollectedMessage;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

/**
 * MyBatis-Flex mapper for collected messages keyed by task, chat and Telegram
 * ID.
 */
@Mapper
public interface TelegramCollectedMessageMapper extends EntityMapper<TelegramCollectedMessage>
{
    /** Finds the idempotency key before a task commits a replayed history page. */
    default Optional<TelegramCollectedMessage> findMessage(Long taskId, String chatId, String messageId)
    {
        return Optional.ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("task_id").eq(taskId))
                .and(new QueryColumn("chat_id").eq(chatId)).and(new QueryColumn("telegram_message_id").eq(messageId))));
    }

    /**
     * Finds a bounded numeric newest-message checkpoint without loading message
     * bodies.
     */
    @Select("""
            SELECT COALESCE(MAX(CAST(telegram_message_id AS UNSIGNED)), 0)
            FROM biz_telegram_collection_message
            WHERE task_id = #{taskId} AND chat_id = #{chatId}
            """)
    long newestMessageId(@org.apache.ibatis.annotations.Param("taskId") Long taskId,
            @org.apache.ibatis.annotations.Param("chatId") String chatId);
}
