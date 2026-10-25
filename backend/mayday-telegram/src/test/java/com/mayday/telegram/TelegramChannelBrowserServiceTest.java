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

    private TelegramMessageSnapshot snapshot(String chatId, String messageId, boolean canSave)
    {
        return new TelegramMessageSnapshot(chatId, messageId, null, false, "history", "VIDEO", "Nature video", "[]",
                "[]", null, 1L, null, canSave, null, null, "[{\"fileName\":\"nature.mp4\"}]", null, null, null);
    }
}
