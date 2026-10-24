package com.mayday.telegram;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Covers album boundaries, partial TDLib pages and the authoritative link
 * anchor.
 */
class TelegramMessageAlbumReaderTest
{
    @Test
    void standaloneMessageDoesNotReadHistory()
    {
        TelegramSessionClient client = mock(TelegramSessionClient.class);
        TelegramMessageSnapshot anchor = message("10", null);

        assertThat(TelegramMessageAlbumReader.read(client, anchor).join()).containsExactly(anchor);
        verifyNoInteractions(client);
    }

    @Test
    void readsBothSidesOfAnAlbumAndExcludesNeighboringPosts()
    {
        TelegramSessionClient client = mock(TelegramSessionClient.class);
        TelegramMessageSnapshot anchor = message("10", "700");
        when(client.getChatHistory("55", "10", 11)).thenReturn(CompletableFuture
                .completedFuture(List.of(anchor, message("9", "700"), message("8", "600"), message("7", "700"))));
        when(client.getNewerChatHistory("55", "10", 2))
                .thenReturn(CompletableFuture.completedFuture(List.of(message("11", "700"), anchor)));
        when(client.getNewerChatHistory("55", "11", 2))
                .thenReturn(CompletableFuture.completedFuture(List.of(message("12", "800"), message("11", "700"))));

        assertThat(TelegramMessageAlbumReader.read(client, anchor).join())
                .extracting(TelegramMessageSnapshot::messageId).containsExactly("10", "9", "11");
        verify(client, never()).getChatHistory("55", "8", 11);
        verify(client, never()).getNewerChatHistory("55", "12", 2);
    }

    @Test
    void continuesShortPagesInsteadOfTreatingRequestedLimitAsActualPageSize()
    {
        TelegramSessionClient client = mock(TelegramSessionClient.class);
        TelegramMessageSnapshot anchor = message("10", "700");
        when(client.getChatHistory("55", "10", 11))
                .thenReturn(CompletableFuture.completedFuture(List.of(anchor, message("9", "700"))));
        when(client.getChatHistory("55", "9", 11))
                .thenReturn(CompletableFuture.completedFuture(List.of(message("9", "700"), message("8", "700"))));
        when(client.getChatHistory("55", "8", 11)).thenReturn(CompletableFuture.completedFuture(List.of()));
        when(client.getNewerChatHistory("55", "10", 2))
                .thenReturn(CompletableFuture.completedFuture(List.of(message("11", "700"))));
        when(client.getNewerChatHistory("55", "11", 2))
                .thenReturn(CompletableFuture.completedFuture(List.of(message("12", "700"))));
        when(client.getNewerChatHistory("55", "12", 2))
                .thenReturn(CompletableFuture.completedFuture(List.of(message("13", null))));

        assertThat(TelegramMessageAlbumReader.read(client, anchor).join())
                .extracting(TelegramMessageSnapshot::messageId).containsExactly("10", "9", "8", "11", "12");
    }

    @Test
    void retriesACursorOnlyCachePageBeforeFollowingLoadedAlbumMembers()
    {
        TelegramSessionClient client = mock(TelegramSessionClient.class);
        TelegramMessageSnapshot anchor = message("10", "700");
        when(client.getChatHistory("55", "10", 11)).thenReturn(CompletableFuture.completedFuture(List.of(anchor)),
                CompletableFuture.completedFuture(List.of(anchor, message("9", "700"), message("8", null))));
        when(client.getNewerChatHistory("55", "10", 2)).thenReturn(CompletableFuture.completedFuture(List.of()));

        assertThat(TelegramMessageAlbumReader.read(client, anchor).join())
                .extracting(TelegramMessageSnapshot::messageId).containsExactly("10", "9");
    }

    @Test
    void keepsTheOriginalAnchorWhenHistoryReturnsOnlyOtherMembers()
    {
        TelegramSessionClient client = mock(TelegramSessionClient.class);
        TelegramMessageSnapshot anchor = message("10", "700");
        when(client.getChatHistory("55", "10", 11))
                .thenReturn(CompletableFuture.completedFuture(List.of(message("9", "700"), message("8", null))));
        when(client.getNewerChatHistory("55", "10", 2)).thenReturn(CompletableFuture.completedFuture(List.of()));

        assertThat(TelegramMessageAlbumReader.read(client, anchor).join()).first().isSameAs(anchor);
    }

    @Test
    void unrelatedChatCannotAddAMemberWithTheSameAlbumId()
    {
        TelegramSessionClient client = mock(TelegramSessionClient.class);
        TelegramMessageSnapshot anchor = message("10", "700");
        TelegramMessageSnapshot otherChat = new TelegramMessageSnapshot("66", "9", null, false, "history", "PHOTO",
                "other chat", "[]", "[]", null, 1L, null, true, "700", null, "[]", null, null, null);
        when(client.getChatHistory("55", "10", 11))
                .thenReturn(CompletableFuture.completedFuture(List.of(otherChat, message("8", null))));
        when(client.getNewerChatHistory("55", "10", 2)).thenReturn(CompletableFuture.completedFuture(List.of()));

        assertThat(TelegramMessageAlbumReader.read(client, anchor).join()).containsExactly(anchor);
    }

    @Test
    void historyFailureDoesNotClaimThatAnAlbumWasCompletelyRead()
    {
        TelegramSessionClient client = mock(TelegramSessionClient.class);
        TelegramMessageSnapshot anchor = message("10", "700");
        when(client.getChatHistory("55", "10", 11))
                .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("history unavailable")));
        when(client.getNewerChatHistory("55", "10", 2)).thenReturn(CompletableFuture.completedFuture(List.of()));

        assertThat(TelegramMessageAlbumReader.read(client, anchor)).isCompletedExceptionally();
    }

    private TelegramMessageSnapshot message(String id, String albumId)
    {
        return new TelegramMessageSnapshot("55", id, null, false, "history", "PHOTO", "caption", "[]", "[]", null, 1L,
                null, true, albumId, null, "[]", null, null, null);
    }
}
