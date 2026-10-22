package com.mayday.telegram;

import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Verifies attachment selection stays bounded by the task's explicit download
 * policy.
 */
class TelegramMediaQueueServiceTest
{
    @Test
    void queuesOnlyTheSelectedAttachmentKindAndKeepsFileIdsOutOfTheTaskView()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramSettings settings = new TelegramSettings();
        TelegramMediaQueueService queue = new TelegramMediaQueueService(mapper, new ObjectMapper(), settings);
        TelegramCollectionTask task = task(true, false, true);
        TelegramCollectedMessage message = message("""
                [
                  {"kind":"PHOTO","tdFileId":11,"expectedSize":4096,"fileName":"photo.jpg"},
                  {"kind":"VIDEO","tdFileId":12,"expectedSize":8192,"fileName":"movie.mp4"},
                  {"kind":"DOCUMENT","tdFileId":13,"expectedSize":16384,"fileName":"guide.pdf"}
                ]
                """);

        queue.enqueue(task, message);

        var rows = org.mockito.ArgumentCaptor.forClass(TelegramMedia.class);
        verify(mapper, org.mockito.Mockito.times(2)).save(rows.capture());
        assertThat(rows.getAllValues()).extracting(TelegramMedia::getKind).containsExactly("PHOTO", "DOCUMENT");
        assertThat(rows.getAllValues()).extracting(TelegramMedia::getTelegramFileId).containsExactly(11, 13);
        assertThat(rows.getAllValues()).allSatisfy(row -> assertThat(row.getStatus()).isEqualTo("QUEUED"));
    }

    @Test
    void doesNotQueueProtectedMessagesOrUnselectedAttachments()
    {
        TelegramMediaMapper mapper = mock(TelegramMediaMapper.class);
        TelegramMediaQueueService queue = new TelegramMediaQueueService(mapper, new ObjectMapper(),
                new TelegramSettings());
        queue.enqueue(task(true, true, true), message("[]", false));
        queue.enqueue(task(false, false, false), message("[{\"kind\":\"PHOTO\",\"tdFileId\":5}]"));

        verify(mapper, never()).save(any(TelegramMedia.class));
    }

    @Test
    void corruptedInternalAttachmentMetadataFailsTheMessagePageInsteadOfSilentlyLosingFiles()
    {
        TelegramMediaQueueService queue = new TelegramMediaQueueService(mock(TelegramMediaMapper.class),
                new ObjectMapper(), new TelegramSettings());

        assertThatThrownBy(() -> queue.enqueue(task(true, false, false), message("not-json")))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("附件元数据格式无效");
    }

    private TelegramCollectionTask task(boolean images, boolean videos, boolean documents)
    {
        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setId(20L);
        task.setOwnerId(7L);
        task.setDepartmentId(3L);
        task.setDownloadImages(images);
        task.setDownloadVideos(videos);
        task.setDownloadDocuments(documents);
        return task;
    }

    private TelegramCollectedMessage message(String metadata)
    {
        return message(metadata, true);
    }

    private TelegramCollectedMessage message(String metadata, boolean canBeSaved)
    {
        TelegramCollectedMessage message = new TelegramCollectedMessage();
        message.setId(30L);
        message.setTaskId(20L);
        message.setCanBeSaved(canBeSaved);
        message.setMetadataJson(metadata);
        return message;
    }
}
