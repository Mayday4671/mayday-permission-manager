package com.mayday.telegram;

import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

import com.mayday.common.exception.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.mapper.TelegramAccountMapper;
import com.mayday.telegram.mapper.TelegramConversationMapper;
import com.mayday.telegram.mapper.TelegramSearchMapper;
import com.mayday.telegram.mapper.TelegramSearchMessageMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Historical buttons must work after reconnect without sending another search.
 */
class TelegramCallbackRecoveryTest
{
    private AccessPolicy access;
    private TelegramSessionClient client;
    private TelegramSearchService service;

    @BeforeEach
    void setUp()
    {
        access = mock(AccessPolicy.class);
        client = mock(TelegramSessionClient.class);
        TelegramSettings settings = new TelegramSettings();
        settings.setSearchBotUsername("@jisou2");
        TelegramSessionCoordinator sessions = mock(TelegramSessionCoordinator.class);
        when(sessions.requireReadyClient("telegram:search")).thenReturn(client);
        TelegramSearchMapper searches = mock(TelegramSearchMapper.class);
        TelegramSearchMessageMapper messages = mock(TelegramSearchMessageMapper.class);
        TelegramSearch search = new TelegramSearch();
        search.setId(1L);
        search.setOwnerId(7L);
        search.setDepartmentId(3L);
        search.setBotChatId("123");
        when(searches.findById(1L)).thenReturn(Optional.of(search));
        TelegramSearchMessage message = new TelegramSearchMessage();
        message.setId(2L);
        message.setOwnerId(7L);
        message.setDepartmentId(3L);
        message.setBotChatId("123");
        message.setTelegramMessageId("456");
        message.setReplyMarkupJson(
                "[[{\"text\":\"下一页\",\"type\":\"CALLBACK\",\"data\":\"" + Base64.getEncoder().encodeToString(new byte[]
                {1, 2, 3}) + "\"}]]");
        when(messages.selectOneByQuery(any())).thenReturn(message);
        service = new TelegramSearchService(mock(TelegramModuleGuard.class), settings, access, sessions,
                mock(TelegramAccountMapper.class), mock(TelegramConversationMapper.class), searches, messages,
                mock(TelegramResultParser.class), mock(TransactionTemplate.class));
    }

    @Test
    void restoresVerificationBeforeSendingTheExactStoredButton()
    {
        AtomicBoolean verified = new AtomicBoolean();
        when(client.resolveBot("jisou2")).thenAnswer(invocation -> {
            verified.set(true);
            return CompletableFuture.completedFuture(new TelegramBotChat("123", "jisou2", "123"));
        });
        when(client.activateCallback(eq("123"), eq("456"), any())).thenAnswer(invocation -> {
            assertThat(verified.get()).isTrue();
            assertThat(invocation.<byte[]>getArgument(2)).containsExactly(1, 2, 3);
            return CompletableFuture.completedFuture(new TelegramCallbackAnswer("", false, ""));
        });

        assertThat(service.activateCallback(1L, 2L, 0, 0).showAlert()).isFalse();
        verify(client, never()).sendSearchText(anyString(), anyString());
    }

    @Test
    void refusesHistoricalButtonsFromADifferentConfiguredBot()
    {
        when(client.resolveBot("jisou2"))
                .thenReturn(CompletableFuture.completedFuture(new TelegramBotChat("999", "jisou2", "999")));

        assertThatThrownBy(() -> service.activateCallback(1L, 2L, 0, 0)).isInstanceOf(BusinessException.class)
                .hasMessageContaining("机器人与这条回复不一致");
        verify(client, never()).activateCallback(anyString(), anyString(), any());
    }

    @Test
    void resolutionFailureNeverSendsTheButtonOrDisclosesPrivateDetails()
    {
        when(client.resolveBot("jisou2"))
                .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("private account detail")));

        assertThatThrownBy(() -> service.activateCallback(1L, 2L, 0, 0)).isInstanceOf(BusinessException.class)
                .hasMessageNotContaining("private account detail");
        verify(client, never()).activateCallback(anyString(), anyString(), any());
    }

    @Test
    void checksDataScopeBeforeContactingTelegram()
    {
        doThrow(new AccessDeniedException("outside scope")).when(access).checkData("telegram", 7L, 3L);

        assertThatThrownBy(() -> service.activateCallback(1L, 2L, 0, 0)).isInstanceOf(AccessDeniedException.class);
        verify(client, never()).resolveBot(anyString());
        verify(client, never()).activateCallback(anyString(), anyString(), any());
    }
}
