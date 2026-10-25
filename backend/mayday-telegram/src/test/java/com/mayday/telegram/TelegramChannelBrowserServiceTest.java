package com.mayday.telegram;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.util.ModuleSwitches;
import com.mayday.security.AccessPolicy;
import it.tdlight.jni.TdApi;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression coverage for membership, cursor boundaries and safe
 * channel-message projections.
 */
class TelegramChannelBrowserServiceTest
{
    private TelegramSessionClient client;
    private TelegramSessionCoordinator sessions;
    private AccessPolicy access;
    private TelegramChannelBrowserService service;

    @BeforeEach
    void setUp()
    {
        ModuleSwitches switches = new ModuleSwitches();
        switches.setEnabled(java.util.Map.of("telegram", true));
        client = mock(TelegramSessionClient.class);
        sessions = mock(TelegramSessionCoordinator.class);
        access = mock(AccessPolicy.class);
        service = new TelegramChannelBrowserService(new TelegramModuleGuard(switches), access, sessions);
        when(sessions.requireReadyClient("telegram:collect")).thenReturn(client);
        when(client.resolveChannel("-1001"))
                .thenReturn(CompletableFuture.completedFuture(new TelegramChannelOption("-1001", "Nature", null)));
    }

    @Test
    void acceptsOnlyCurrentChannelMembers()
    {
        assertThat(TelegramChannelMembership.isJoined(new TdApi.ChatMemberStatusMember())).isTrue();
        assertThat(TelegramChannelMembership.isJoined(new TdApi.ChatMemberStatusAdministrator())).isTrue();
        assertThat(TelegramChannelMembership.isJoined(new TdApi.ChatMemberStatusCreator(false, true))).isTrue();
        assertThat(TelegramChannelMembership.isJoined(new TdApi.ChatMemberStatusCreator(false, false))).isFalse();
        assertThat(TelegramChannelMembership.isJoined(new TdApi.ChatMemberStatusLeft())).isFalse();
        assertThat(TelegramChannelMembership.isJoined(new TdApi.ChatMemberStatusBanned())).isFalse();
        assertThat(TelegramChannelMembership.isJoined(null)).isFalse();
    }

    @Test
    void opensDirectoryWithoutASearchAndPreservesArchiveCursor()
    {
        var expected = new TelegramChannelBrowserService.ChannelPage(List.of(), "1:0");
        when(client.browseChannels("0:0")).thenReturn(CompletableFuture.completedFuture(expected));
        assertThat(service.channels("0:0")).isEqualTo(expected);
    }

    @Test
    void excludesInclusiveCursorAndMessagesFromAnotherChannel()
    {
        when(client.getChatHistory("-1001", "30", 21))
                .thenReturn(CompletableFuture.completedFuture(List.of(snapshot("-1001", "30", true),
                        snapshot("-1001", "29", true), snapshot("-999", "28", true), snapshot("-1001", "27", true))));
        var page = service.messages("-1001", "30");
        assertThat(page.items()).extracting(TelegramChannelBrowserService.ChannelMessage::id).containsExactly("29",
                "27");
        assertThat(page.nextCursor()).isEqualTo("27");
        verify(client).resolveChannel("-1001");
    }

    @Test
    void shortHistoryPageStillOffersContinuationAndProtectedTextIsOmitted()
    {
        when(client.getChatHistory("-1001", "0", 21))
                .thenReturn(CompletableFuture.completedFuture(List.of(snapshot("-1001", "10", false))));
        var page = service.messages("-1001", "0");
        assertThat(page.nextCursor()).isEqualTo("10");
        assertThat(page.items().getFirst().text()).isNull();
        assertThat(page.items().getFirst().hasMedia()).isFalse();
    }

    @Test
    void anEmptyPageEndsHistory()
    {
        when(client.getChatHistory("-1001", "10", 21)).thenReturn(CompletableFuture.completedFuture(List.of()));
        assertThat(service.messages("-1001", "10").nextCursor()).isNull();
    }

    @Test
    void rejectsUnjoinedChannelBeforeReadingMessages()
    {
        when(client.resolveChannel("-1001"))
                .thenReturn(CompletableFuture.failedFuture(new IllegalArgumentException("left")));
        assertThatThrownBy(() -> service.messages("-1001", "0")).isInstanceOf(BusinessException.class);
        verify(client, never()).getChatHistory("-1001", "0", 21);
    }

    @Test
    void resolvesCanonicalPrivateLinkWithoutConvertingMessageIdentifiers()
    {
        when(client.messageLink("-1001", "1048576"))
                .thenReturn(CompletableFuture.completedFuture("https://t.me/c/12345/1"));
        assertThat(service.link("-1001", "1048576")).isEqualTo("https://t.me/c/12345/1");
        verify(client).resolveChannel("-1001");
    }

    @Test
    void rejectsInvalidCursorAndOverflowingIdentifiers()
    {
        assertThatThrownBy(() -> service.channels("2:-1")).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.messages("-1001", "9999999999999999999"))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void revokedPermissionStopsReadsBeforeSessionAccess()
    {
        doThrow(new AccessDeniedException("revoked")).when(access).require("telegram:collect");
        assertThatThrownBy(() -> service.channels("0:0")).isInstanceOf(AccessDeniedException.class);
        verify(sessions, never()).requireReadyClient("telegram:collect");
    }

    @Test
    void searchesBeyondTheLoadedPageAndRetainsNativeCursor()
    {
        when(client.channelMessageAtDate("-1001", 1)).thenReturn(CompletableFuture.completedFuture("0"));
        when(client.searchChannelMessages("-1001", "nature", "VIDEO", "0"))
                .thenReturn(CompletableFuture.completedFuture(new TelegramChannelBrowserService.SearchBatch(
                        List.of(snapshot("-1001", "21", false), snapshot("-999", "20", true)), "19")));
        when(client.searchChannelMessages("-1001", "nature", "VIDEO", "19"))
                .thenReturn(CompletableFuture.completedFuture(
                        new TelegramChannelBrowserService.SearchBatch(List.of(snapshot("-1001", "19", true)), "18")));
        var page = service.search("-1001", " nature ", "VIDEO", "0", 1L, 1L);
        assertThat(page.items()).extracting(TelegramChannelBrowserService.ChannelMessage::id).containsExactly("19");
        assertThat(page.nextCursor()).isEqualTo("18");
        verify(client).resolveChannel("-1001");
    }

    @Test
    void dateFilteringStopsAfterFiveBatchesAndReturnsContinuation()
    {
        when(client.channelMessageAtDate("-1001", 5)).thenReturn(CompletableFuture.completedFuture("0"));
        for (int index = 0; index < 5; index++)
        {
            when(client.searchChannelMessages("-1001", "", "PHOTO", Integer.toString(index)))
                    .thenReturn(CompletableFuture.completedFuture(new TelegramChannelBrowserService.SearchBatch(
                            List.of(snapshot("-1001", "10", false)), Integer.toString(index + 1))));
        }
        var page = service.search("-1001", "", "PHOTO", "0", 0L, 5L);
        assertThat(page.items()).isEmpty();
        assertThat(page.nextCursor()).isEqualTo("5");
        verify(client, never()).searchChannelMessages("-1001", "", "PHOTO", "5");
    }

    @Test
    void dateAnchorCanReturnNoMessagesAndLowerDateBoundEndsSearch()
    {
        when(client.channelMessageAtDate("-1001", 5)).thenReturn(CompletableFuture.completedFuture(null));
        assertThat(service.search("-1001", "", "ALL", "0", 2L, 5L).items()).isEmpty();
        when(client.channelMessageAtDate("-1001", 5)).thenReturn(CompletableFuture.completedFuture("10"));
        when(client.searchChannelMessages("-1001", "", "ALL", "10")).thenReturn(CompletableFuture.completedFuture(
                new TelegramChannelBrowserService.SearchBatch(List.of(snapshot("-1001", "10", true)), "9")));
        var page = service.search("-1001", "", "ALL", "0", 2L, 5L);
        assertThat(page.items()).isEmpty();
        assertThat(page.nextCursor()).isNull();
    }

    @Test
    void rejectsStuckSearchCursorInsteadOfLooping()
    {
        when(client.searchChannelMessages("-1001", "", "ALL", "10")).thenReturn(
                CompletableFuture.completedFuture(new TelegramChannelBrowserService.SearchBatch(List.of(), "10")));
        assertThatThrownBy(() -> service.search("-1001", "", "ALL", "10", null, null))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void validatesSearchTypesKeywordLengthAndDateOrder()
    {
        assertThatThrownBy(() -> service.search("-1001", "", "INVALID", "0", null, null))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.search("-1001", "a".repeat(201), "ALL", "0", null, null))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.search("-1001", "", "ALL", "0", 10L, 1L))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.search("-1001", "", "ALL", "0", -1L, null))
                .isInstanceOf(BusinessException.class);
    }

    private TelegramMessageSnapshot snapshot(String chatId, String messageId, boolean canSave)
    {
        return new TelegramMessageSnapshot(chatId, messageId, null, false, "history", "VIDEO", "Nature video", "[]",
                "[]", null, 1L, null, canSave, null, null, "[{\"fileName\":\"nature.mp4\"}]", null, null, null);
    }
}
