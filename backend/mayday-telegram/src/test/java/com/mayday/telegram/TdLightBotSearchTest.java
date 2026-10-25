package com.mayday.telegram;

import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;

import it.tdlight.ClientFactory;
import it.tdlight.TelegramClient;
import it.tdlight.jni.TdApi;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * First-turn searches must send the keyword alone, even after a TDLib
 * reconnect.
 */
class TdLightBotSearchTest
{
    private TelegramClient transport;
    private TdApi.User bot;

    @BeforeEach
    void setUp()
    {
        transport = mock(TelegramClient.class);
        var chat = new TdApi.Chat();
        chat.id = 123;
        chat.type = new TdApi.ChatTypePrivate(456);
        bot = new TdApi.User();
        bot.id = 456;
        bot.type = new TdApi.UserTypeBot();
        when(transport.sendAsync(any(TdApi.SearchPublicChat.class)))
                .thenReturn(CompletableFuture.completedFuture(chat));
        when(transport.sendAsync(any(TdApi.GetUser.class))).thenReturn(CompletableFuture.completedFuture(bot));
        var sent = new TdApi.Message();
        sent.id = 789;
        when(transport.sendAsync(any(TdApi.SendMessage.class))).thenReturn(CompletableFuture.completedFuture(sent));
    }

    @Test
    void freshAndReconnectedClientsSendOnlyTheRequestedKeyword()
    {
        for (String query : new String[]
        {"Python 官方文档", "Java 官方文档"})
        {
            TelegramSessionClient session = session();
            var resolved = session.resolveBot("jisou2").join();
            assertThat(session.sendSearchText(resolved.chatId(), query).join()).isEqualTo("789");
        }
        var requests = ArgumentCaptor.forClass(TdApi.SendMessage.class);
        verify(transport, times(2)).sendAsync(requests.capture());
        assertThat(requests.getAllValues())
                .extracting(request -> ((TdApi.InputMessageText) request.inputMessageContent).text.text)
                .containsExactly("Python 官方文档", "Java 官方文档");
        verify(transport, never()).sendAsync(any(TdApi.SendBotStartMessage.class));
    }

    @Test
    void resolvingAgainDoesNotSendCommandsOrMessages()
    {
        TelegramSessionClient session = session();
        session.resolveBot("jisou2").join();
        session.resolveBot("jisou2").join();
        verify(transport, never()).sendAsync(any(TdApi.SendBotStartMessage.class));
        verify(transport, never()).sendAsync(any(TdApi.SendMessage.class));
    }

    @Test
    void refusesNonBotsAndUnverifiedDestinations()
    {
        TelegramSessionClient session = session();
        assertThatThrownBy(() -> session.sendSearchText("123", "Python").join())
                .hasRootCauseInstanceOf(IllegalStateException.class);
        bot.type = new TdApi.UserTypeRegular();
        assertThatThrownBy(() -> session.resolveBot("jisou2").join())
                .hasRootCauseInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> session.sendSearchText("123", "Python").join())
                .hasRootCauseInstanceOf(IllegalStateException.class);
        verify(transport, never()).sendAsync(any(TdApi.SendMessage.class));
    }

    private TelegramSessionClient session()
    {
        return new TdLightTelegramSessionClientProvider.TdLightSessionClient(mock(ClientFactory.class), transport,
                new TelegramSettings(), Path.of("unused-test-session"), new byte[32], update -> {
                }, message -> {
                }, new ObjectMapper());
    }
}
