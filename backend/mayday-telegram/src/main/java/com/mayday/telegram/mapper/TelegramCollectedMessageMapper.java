package com.mayday.telegram.mapper;

import java.util.List;
import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramCollectedMessage;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
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
     * Reads title candidates only from the selected message and its collected
     * album.
     */
    @Select("""
            SELECT m.message_text, m.metadata_json, m.can_be_saved
            FROM biz_telegram_collection_message m
            WHERE m.task_id = #{taskId} AND m.can_be_saved = 1
              AND (m.telegram_message_id = #{messageId}
                OR (#{includeAlbum} = TRUE AND m.album_id IS NOT NULL AND m.album_id <> '0'
                  AND m.album_id <> '' AND m.album_id = (
                    SELECT a.album_id FROM biz_telegram_collection_message a
                    WHERE a.task_id = #{taskId} AND a.telegram_message_id = #{messageId}
                    LIMIT 1)))
            ORDER BY (m.telegram_message_id = #{messageId}) DESC, m.id ASC
            LIMIT 10
            """)
    @Results(
    {@Result(column = "message_text", property = "messageText"),
            @Result(column = "metadata_json", property = "metadataJson"),
            @Result(column = "can_be_saved", property = "canBeSaved")})
    List<TelegramCollectedMessage> findTitleCandidates(@Param("taskId") Long taskId,
            @Param("messageId") String messageId, @Param("includeAlbum") boolean includeAlbum);

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
