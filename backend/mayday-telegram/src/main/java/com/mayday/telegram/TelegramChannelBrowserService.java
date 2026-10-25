package com.mayday.telegram;

import java.util.List;
import java.util.concurrent.CompletionException;
import java.util.function.Supplier;

import com.mayday.common.exception.BusinessException;
import com.mayday.security.AccessPolicy;
import lombok.RequiredArgsConstructor;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;

/**
 * Read-only channel browsing; viewing never creates collection tasks or marks
 * messages read.
 */
@Service
@RequiredArgsConstructor
public class TelegramChannelBrowserService
{
    private final TelegramModuleGuard guard;
    private final AccessPolicy access;
    private final TelegramSessionCoordinator sessions;

    /** Bounded directory batch with an opaque continuation cursor. */
    public record ChannelPage(List<TelegramChannelOption> items, @Nullable String nextCursor) {
    }

    /**
     * Message presentation without session file identifiers or protected message
     * contents.
     */
    public record ChannelMessage(String id, @Nullable String text, String contentType, boolean canBeSaved,
            @Nullable Long sentAt, boolean hasMedia) {
    }

    /**
     * Newest-first message batch; a short batch does not imply the end of Telegram
     * history.
     */
    public record MessagePage(List<ChannelMessage> items, @Nullable String nextCursor) {
    }

    /**
     * Uses the same access requirements as the existing joined-channel collection
     * selector.
     */
    private TelegramSessionClient client()
    {
        guard.requireEnabled();
        access.require("telegram:view");
        access.require("telegram:collect");
        return sessions.requireReadyClient("telegram:collect");
    }

    /** Loads main-list and archived channels without joining chats. */
    public ChannelPage channels(String cursor)
    {
        TelegramSessionClient client = client();
        if (cursor == null || !cursor.matches("[01]:[0-9]{1,5}"))
        {
            throw new BusinessException("频道分页游标无效，请刷新频道列表");
        }
        return read(() -> client.browseChannels(cursor).join());
    }

    /**
     * Verifies current membership on every history read and excludes the inclusive
     * cursor.
     */
    public MessagePage messages(String chatId, String before)
    {
        TelegramSessionClient client = client();
        requireId(chatId, true);
        requireId(before, false);
        return read(() -> {
            client.resolveChannel(chatId).join();
            var snapshots = client.getChatHistory(chatId, before, 21).join().stream()
                    .filter(item -> chatId.equals(item.chatId()))
                    .filter(item -> "0".equals(before) || Long.parseLong(item.messageId()) < Long.parseLong(before))
                    .sorted((left, right) -> Long.compare(Long.parseLong(right.messageId()),
                            Long.parseLong(left.messageId())))
                    .limit(20).toList();
            String next = snapshots.isEmpty() ? null : snapshots.getLast().messageId();
            return new MessagePage(snapshots.stream()
                    .map(item -> new ChannelMessage(item.messageId(), item.canBeSaved() ? item.text() : null,
                            item.contentType(), item.canBeSaved(), item.sentAtEpochSeconds(),
                            item.canBeSaved() && item.attachmentMetadataJson() != null
                                    && !"[]".equals(item.attachmentMetadataJson())))
                    .toList(), next);
        });
    }

    /** Resolves a selected post for the existing preview and collection flows. */
    public String link(String chatId, String messageId)
    {
        TelegramSessionClient client = client();
        requireId(chatId, true);
        requireId(messageId, false);
        if ("0".equals(messageId))
        {
            throw new BusinessException("请选择一条频道消息");
        }
        return read(() -> {
            client.resolveChannel(chatId).join();
            return TelegramMessageLinkValidator.validate(client.messageLink(chatId, messageId).join());
        });
    }

    private static void requireId(String value, boolean signed)
    {
        try
        {
            if (value == null || !value.matches(signed ? "-?[0-9]{1,19}" : "[0-9]{1,19}"))
            {
                throw new IllegalArgumentException();
            }
            Long.parseLong(value);
        } catch (IllegalArgumentException exception)
        {
            throw new BusinessException("频道或消息标识无效");
        }
    }

    private static <T> T read(Supplier<T> operation)
    {
        try
        {
            return operation.get();
        } catch (CompletionException | IllegalArgumentException exception)
        {
            throw new BusinessException("频道读取失败，请确认账号已连接且仍在该频道中，然后重试");
        }
    }
}
