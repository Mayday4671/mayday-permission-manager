package com.mayday.telegram;

import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;

import it.tdlight.ClientFactory;
import it.tdlight.TelegramClient;
import it.tdlight.jni.TdApi;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies source-provided alternatives and protection checks without media
 * transfers.
 */
class TdLightVideoQualityTest
{
    @Test
    void listsOriginalAndActualAlternativesWithoutInventingResolutions()
    {
        var message = video();
        assertThat(TelegramVideoQuality.from(message)).hasSize(1);
        var alternate = new TdApi.AlternativeVideo();
        alternate.id = Long.MAX_VALUE;
        alternate.width = 720;
        alternate.height = 1280;
        alternate.codec = "h264";
        alternate.video = new TdApi.File();
        alternate.video.id = 42;
        alternate.video.size = 512;
        message.alternativeVideos = new TdApi.AlternativeVideo[]
        {alternate, alternate, null};
        var options = TelegramVideoQuality.from(message);
        assertThat(options).hasSize(2);
        assertThat(options.get(1).id()).isEqualTo("alt:9223372036854775807");
        assertThat(options.get(1).width()).isEqualTo(720);
        assertThat(options.get(1).fileId()).isEqualTo(42);
    }

    @Test
    void qualitiesResolvePublicSourceAfterReconnectAndRejectProtectedMessages()
    {
        TelegramClient transport = mock(TelegramClient.class);
        var source = new TdApi.Message();
        source.id = 100;
        source.chatId = -10001;
        source.canBeSaved = true;
        source.content = video();
        var link = new TdApi.MessageLinkInfo();
        link.message = source;
        when(transport.sendAsync(any(TdApi.GetMessage.class)))
                .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("not cached")));
        when(transport.sendAsync(any(TdApi.GetMessageLinkInfo.class)))
                .thenReturn(CompletableFuture.completedFuture(link));
        var session = new TdLightTelegramSessionClientProvider.TdLightSessionClient(mock(ClientFactory.class),
                transport, new TelegramSettings(), Path.of("unused-test-session"), new byte[32], update -> {
                }, message -> {
                }, new ObjectMapper());
        assertThat(session.videoQualities("https://t.me/telegram/1", "-10001", "100").join()).hasSize(1);
        source.canBeSaved = false;
        assertThatThrownBy(() -> session.videoQualities("https://t.me/telegram/1", "-10001", "100").join())
                .hasRootCauseInstanceOf(IllegalStateException.class);
        source.canBeSaved = true;
        source.chatId = -999;
        assertThatThrownBy(() -> session.videoQualities("https://t.me/telegram/1", "-10001", "100").join())
                .hasRootCauseInstanceOf(IllegalStateException.class);
        verify(transport, never()).sendAsync(any(TdApi.DownloadFile.class));
        verify(transport, never()).sendAsync(any(TdApi.JoinChat.class));
    }

    private TdApi.MessageVideo video()
    {
        var content = new TdApi.MessageVideo();
        content.video = new TdApi.Video();
        content.video.width = 1080;
        content.video.height = 1920;
        content.video.video = new TdApi.File();
        content.video.video.id = 123;
        return content;
    }
}
