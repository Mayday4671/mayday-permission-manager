package com.mayday.telegram;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Reads one Telegram media group around its already-resolved link snapshot.
 *
 * <p>
 * TDLib may return fewer history rows than requested. Each direction therefore
 * advances only to a returned member and continues until a different album or
 * the accessible history boundary is reached. Newer reads request exactly one
 * neighbor plus the inclusive cursor so a short response cannot skip members.
 */
final class TelegramMessageAlbumReader
{
    static final int MAX_ALBUM_MESSAGES = 10;
    private static final int MAX_STALLED_READS = 2;
    private static final long READ_DEADLINE_SECONDS = 35;

    private TelegramMessageAlbumReader()
    {
    }

    /** Keeps the link snapshot first; repeated history copies never replace it. */
    static CompletableFuture<List<TelegramMessageSnapshot>> read(TelegramSessionClient client,
            TelegramMessageSnapshot anchor)
    {
        if (anchor.albumId() == null || anchor.albumId().isBlank() || "0".equals(anchor.albumId()))
        {
            return CompletableFuture.completedFuture(List.of(anchor));
        }
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(READ_DEADLINE_SECONDS);
        CompletableFuture<List<TelegramMessageSnapshot>> older = readDirection(client, anchor, anchor.messageId(),
                false, new ArrayList<>(), 0, deadline);
        CompletableFuture<List<TelegramMessageSnapshot>> newer = readDirection(client, anchor, anchor.messageId(), true,
                new ArrayList<>(), 0, deadline);
        return older.thenCombine(newer, (olderMessages, newerMessages) -> {
            var album = new LinkedHashMap<String, TelegramMessageSnapshot>();
            album.put(anchor.messageId(), anchor);
            olderMessages.forEach(message -> album.putIfAbsent(message.messageId(), message));
            newerMessages.forEach(message -> album.putIfAbsent(message.messageId(), message));
            if (album.size() > MAX_ALBUM_MESSAGES)
            {
                throw new IllegalStateException("Telegram 相册成员超过单组上限，已停止采集");
            }
            return List.copyOf(album.values());
        });
    }

    /**
     * Stops at the nearest nonmember. A limited retry handles TDLib returning only
     * its cached cursor while the native client is loading adjacent history.
     */
    private static CompletableFuture<List<TelegramMessageSnapshot>> readDirection(TelegramSessionClient client,
            TelegramMessageSnapshot anchor, String cursor, boolean newer, List<TelegramMessageSnapshot> members,
            int stalledReads, long deadline)
    {
        if (System.nanoTime() >= deadline)
        {
            return CompletableFuture.failedFuture(new java.util.concurrent.TimeoutException("Telegram 相册读取超时"));
        }
        CompletableFuture<List<TelegramMessageSnapshot>> request = newer
                ? client.getNewerChatHistory(anchor.chatId(), cursor, 2)
                : client.getChatHistory(anchor.chatId(), cursor, MAX_ALBUM_MESSAGES + 1);
        return request.thenCompose(page -> {
            long cursorId = Long.parseLong(cursor);
            Comparator<TelegramMessageSnapshot> order = Comparator
                    .comparingLong(message -> Long.parseLong(message.messageId()));
            List<TelegramMessageSnapshot> adjacent = page.stream()
                    .filter(message -> anchor.chatId().equals(message.chatId()))
                    .filter(message -> newer
                            ? Long.parseLong(message.messageId()) > cursorId
                            : Long.parseLong(message.messageId()) < cursorId)
                    .sorted(newer ? order : order.reversed()).toList();
            String nextCursor = cursor;
            for (TelegramMessageSnapshot message : adjacent)
            {
                if (!anchor.albumId().equals(message.albumId()))
                {
                    return CompletableFuture.completedFuture(List.copyOf(members));
                }
                if (members.stream().noneMatch(member -> member.messageId().equals(message.messageId())))
                {
                    members.add(message);
                }
                nextCursor = message.messageId();
                if (members.size() >= MAX_ALBUM_MESSAGES - 1)
                {
                    return CompletableFuture.completedFuture(List.copyOf(members));
                }
            }
            if (nextCursor.equals(cursor))
            {
                if (page.isEmpty() || stalledReads >= MAX_STALLED_READS)
                {
                    return CompletableFuture.completedFuture(List.copyOf(members));
                }
                return CompletableFuture.completedFuture(null).thenComposeAsync(
                        ignored -> readDirection(client, anchor, cursor, newer, members, stalledReads + 1, deadline),
                        CompletableFuture.delayedExecutor(250, TimeUnit.MILLISECONDS));
            }
            return readDirection(client, anchor, nextCursor, newer, members, 0, deadline);
        });
    }
}
