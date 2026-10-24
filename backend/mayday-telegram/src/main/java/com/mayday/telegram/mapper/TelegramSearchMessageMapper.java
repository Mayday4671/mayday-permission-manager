package com.mayday.telegram.mapper;

import java.util.List;
import java.util.Optional;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.telegram.TelegramSearchMessage;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/** Data-access boundary for idempotently updated bot message snapshots. */
@Mapper
public interface TelegramSearchMessageMapper extends EntityMapper<TelegramSearchMessage>
{
    /** Reads the unique chat/message projection before applying an update event. */
    default Optional<TelegramSearchMessage> findMessage(String chatId, String messageId)
    {
        return Optional
                .ofNullable(selectOneByQuery(QueryWrapper.create().where(new QueryColumn("bot_chat_id").eq(chatId))
                        .and(new QueryColumn("telegram_message_id").eq(messageId))));
    }

    /**
     * Resolves a TDLib message update across the temporary-to-final ID change
     * emitted after an outgoing message is accepted by Telegram. Reusing the
     * temporary row keeps one transcript entry for one sent message.
     */
    default Optional<TelegramSearchMessage> findMessageForUpdate(String chatId, String messageId,
            String previousMessageId)
    {
        Optional<TelegramSearchMessage> current = findMessage(chatId, messageId);
        if (previousMessageId == null || previousMessageId.equals(messageId))
        {
            return current;
        }

        Optional<TelegramSearchMessage> previous = findMessage(chatId, previousMessageId);
        if (current.isPresent())
        {
            previous.filter(message -> !message.getId().equals(current.get().getId()))
                    .ifPresent(message -> deleteById(message.getId()));
            return current;
        }
        return previous;
    }

    /**
     * Reads early bot replies that arrived before SendMessage returned its final
     * message ID.
     */
    default List<TelegramSearchMessage> findReplies(String chatId, String replyToMessageId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("bot_chat_id").eq(chatId))
                .and(new QueryColumn("reply_to_message_id").eq(replyToMessageId))
                .and(new QueryColumn("outgoing").eq(false)));
    }
}
