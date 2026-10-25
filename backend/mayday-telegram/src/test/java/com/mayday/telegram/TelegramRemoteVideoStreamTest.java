package com.mayday.telegram;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;

import com.mayday.common.exception.BusinessException;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Verifies real response bodies, seeking, bounded memory and preview/collection
 * separation.
 */
class TelegramRemoteVideoStreamTest
{
    private static final long SIZE = 4L * 1024 * 1024 * 1024;
    private final TelegramSessionClient client = mock(TelegramSessionClient.class);
    private final TelegramMedia media = new TelegramMedia();

    @BeforeEach
    void setup()
    {
        media.setId(10L);
        media.setTelegramFileId(5);
        when(client.fileSize(5)).thenReturn(CompletableFuture.completedFuture(SIZE));
        when(client.readFileRange(eq(5), anyLong(), anyInt())).thenAnswer(call -> {
            long offset = call.getArgument(1);
            int count = call.getArgument(2);
            assertThat(count).isBetween(1, TelegramRemoteVideoStream.CHUNK_BYTES);
            byte[] bytes = new byte[count];
            for (int index = 0; index < count; index++)
            {
                bytes[index] = (byte) ((offset + index) % 251);
            }
            if (offset == 0 && count >= 12)
            {
                bytes[4] = 'f';
                bytes[5] = 't';
                bytes[6] = 'y';
                bytes[7] = 'p';
            }
            return CompletableFuture.completedFuture(bytes);
        });
    }

    @Test
    void openEndedRangeStartsPlaybackWithoutReadingFourGiB() throws IOException
    {
        var response = TelegramRemoteVideoStream.response(client, media, "bytes=0-", false);
        assertThat(response.getStatusCode().value()).isEqualTo(206);
        assertThat(response.getHeaders().getFirst("Content-Range")).isEqualTo("bytes 0-1048575/4294967296");
        assertThat(response.getHeaders().getContentLength()).isEqualTo(1024 * 1024);
        try (var body = response.getBody().getInputStream())
        {
            assertThat(body.readAllBytes()).hasSize(1024 * 1024);
        }
        verify(client).readFileRange(5, 0, 16);
        verify(client).readFileRange(5, 0, 1024 * 1024);
        verify(client, never()).downloadFile(anyInt(), anyLong());
    }

    @Test
    void tailRangeReadsOnlyRequestedBytesAboveTwoGiB() throws IOException
    {
        var response = TelegramRemoteVideoStream.response(client, media, "bytes=-64", false);
        assertThat(response.getHeaders().getFirst("Content-Range")).isEqualTo("bytes 4294967232-4294967295/4294967296");
        try (var body = response.getBody().getInputStream())
        {
            byte[] bytes = body.readAllBytes();
            assertThat(bytes).hasSize(64);
            assertThat(bytes[0]).isEqualTo((byte) ((SIZE - 64) % 251));
        }
        verify(client).readFileRange(5, SIZE - 64, 64);
    }

    @Test
    void invalidRangeDoesNotFetchAnyBodyAndClosingStopsAdditionalReads() throws IOException
    {
        assertThat(
                TelegramRemoteVideoStream.response(client, media, "bytes=4294967296-", false).getStatusCode().value())
                .isEqualTo(416);
        verify(client, never()).readFileRange(anyInt(), anyLong(), anyInt());
        var response = TelegramRemoteVideoStream.response(client, media, null, true);
        assertThat(response.getHeaders().getContentLength()).isEqualTo(SIZE);
        var body = response.getBody().getInputStream();
        body.readNBytes(20);
        body.close();
        clearInvocations(client);
        assertThatThrownBy(body::read).isInstanceOf(IOException.class);
        verifyNoInteractions(client);
    }

    @Test
    void rejectsFakeVideoHeaders()
    {
        assertThatThrownBy(() -> TelegramRemoteVideoStream.nativeType("<html>unsafe</html>".getBytes()))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void previewVideoDoesNotEnterFullDownloadQueueButExplicitCollectionDoes()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramMediaQueueService queue = new TelegramMediaQueueService(mapper, JsonMapper.builder().build(),
                new TelegramSettings());
        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setId(1L);
        task.setDownloadVideos(true);
        task.setPreviewOnly(true);
        TelegramCollectedMessage message = new TelegramCollectedMessage();
        message.setCanBeSaved(true);
        message.setMetadataJson(
                "[{\"kind\":\"VIDEO\",\"tdFileId\":5,\"expectedSize\":4294967296,\"fileName\":\"clip.mp4\"}]");
        queue.enqueue(task, message);
        verify(mapper).save(org.mockito.ArgumentMatchers.argThat(row -> "REMOTE".equals(row.getStatus())));
        clearInvocations(mapper);
        task.setPreviewOnly(false);
        queue.enqueue(task, message);
        verify(mapper).save(org.mockito.ArgumentMatchers.argThat(row -> "QUEUED".equals(row.getStatus())));
    }
}
