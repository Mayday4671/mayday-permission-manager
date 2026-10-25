package com.mayday.telegram;

import java.io.ByteArrayInputStream;
import java.io.RandomAccessFile;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

import com.mayday.common.util.BusinessTime;
import com.mayday.common.util.ModuleSwitches;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Exercises large-file reservations, long-lived leases, actual byte copies and
 * ranges above 2 GiB.
 */
class TelegramLargeMediaTest
{
    @TempDir
    Path directory;
    TelegramSettings settings = new TelegramSettings();
    TelegramMediaMapper media = mock(TelegramMediaMapper.class);
    TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
    TelegramCollectedMessageMapper messages = mock(TelegramCollectedMessageMapper.class);
    TelegramSessionCoordinator sessions = mock(TelegramSessionCoordinator.class);
    TelegramSessionClient client = mock(TelegramSessionClient.class);
    AccessPolicy access = mock(AccessPolicy.class);
    UserMapper users = mock(UserMapper.class);
    StorageSettings storageSettings = mock(StorageSettings.class);
    StoredFileContent files = mock(StoredFileContent.class);
    FileStorage storage = mock(FileStorage.class);
    TelegramMediaStateService states;
    TelegramMediaDownloadService service;
    TelegramMedia row;
    TelegramCollectionTask task;

    @BeforeEach
    void setup()
    {
        ModuleSwitches switches = new ModuleSwitches();
        switches.setEnabled(Map.of("telegram", true));
        states = spy(new TelegramMediaStateService(media, tasks));
        service = new TelegramMediaDownloadService(new TelegramModuleGuard(switches), access, users, settings,
                storageSettings, files, sessions, media, tasks, messages, states);
        row = new TelegramMedia();
        row.setId(1L);
        row.setOwnerId(2L);
        row.setTaskId(3L);
        row.setMessageId(4L);
        row.setTelegramFileId(5);
        row.setKind("VIDEO");
        row.setStatus("QUEUED");
        row.setExpectedSize(4L * 1024 * 1024 * 1024);
        task = new TelegramCollectionTask();
        task.setId(3L);
        task.setStatus("COMPLETED");
        task.setDownloadVideos(true);
        TelegramCollectedMessage message = new TelegramCollectedMessage();
        message.setId(4L);
        message.setTaskId(3L);
        message.setCanBeSaved(true);
        SysUser owner = new SysUser();
        owner.setId(2L);
        when(users.findById(2L)).thenReturn(Optional.of(owner));
        when(access.hasFor(eq(owner), anyString())).thenReturn(true);
        when(access.containsFor(eq(owner), eq("telegram"), eq(2L), isNull())).thenReturn(true);
        when(media.lockNext()).thenReturn(row);
        when(media.lock(1L)).thenReturn(Optional.of(row));
        when(media.findById(1L)).thenReturn(Optional.of(row));
        when(tasks.findById(3L)).thenReturn(Optional.of(task));
        when(messages.findById(4L)).thenReturn(Optional.of(message));
        when(sessions.requireMediaClient(2L)).thenReturn(client);
        when(storageSettings.provider()).thenReturn("LOCAL");
        when(storageSettings.localRoot()).thenReturn(directory);
        settings.setDataDirectory(directory);
        settings.setMinimumFreeDiskBytes(0);
        when(files.storage("LOCAL")).thenReturn(storage);
        when(storage.provider()).thenReturn("LOCAL");
    }

    @Test
    void remoteStreamResolvesFreshFileHandleInsteadOfTrustingPersistedId() throws Exception
    {
        row.setStatus("REMOTE");
        row.setAttachmentIndex(0);
        task.setPreviewOnly(true);
        task.setMessageLink("https://t.me/example/10");
        TelegramCollectedMessage source = messages.findById(4L).orElseThrow();
        source.setChatId("-100123");
        source.setTelegramMessageId("10485760");
        when(client.resolveMediaFile("https://t.me/example/10", "-100123", "10485760", 0))
                .thenReturn(CompletableFuture.completedFuture(99));
        when(client.fileSize(99)).thenReturn(CompletableFuture.completedFuture(2048L));
        byte[] header = new byte[16];
        header[4] = 'f';
        header[5] = 't';
        header[6] = 'y';
        header[7] = 'p';
        when(client.readFileRange(99, 0, 16)).thenReturn(CompletableFuture.completedFuture(header));
        var response = service.content(1L, "bytes=0-15");
        assertThat(response.getStatusCode().value()).isEqualTo(206);
        try (var input = response.getBody().getInputStream())
        {
            assertThat(input.readAllBytes()).isEqualTo(header);
        }
        verify(client, org.mockito.Mockito.never()).fileSize(5);
    }

    @Test
    void remoteTicketRequiresExplicitPreviewTaskAndCurrentSourcePermission()
    {
        row.setStatus("REMOTE");
        task.setPreviewOnly(true);
        assertThat(service.createStreamTicket(1L).url()).contains("/stream?ticket=");
        task.setStatus("CANCELLED");
        assertThatThrownBy(() -> service.createStreamTicket(1L))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        task.setStatus("COMPLETED");
        task.setPreviewOnly(false);
        assertThatThrownBy(() -> service.createStreamTicket(1L))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    }

    @Test
    void reservesFourGiBWithoutReservingTheEntireStorageBudget()
    {
        when(media.reservedStorageBytes(anyLong())).thenReturn(1024L * 1024 * 1024);
        assertThat(service.claimNext()).isSameAs(row);
        assertThat(row.getReservedBytes()).isGreaterThan(4L * 1024 * 1024 * 1024).isLessThan(5L * 1024 * 1024 * 1024);
        verify(media).lockStorageBudget();
    }

    @Test
    void explainsAggregateCapacityInsteadOfClaimingThereIsASingleFileCap()
    {
        when(media.reservedStorageBytes(anyLong())).thenReturn(8L * 1024 * 1024 * 1024);
        assertThat(service.claimNext()).isNull();
        assertThat(row.getFailureMessage()).contains("剩余存储空间不足");
    }

    @Test
    void persistsMoreThan512MiBUsingStreamingReads() throws Exception
    {
        long size = 513L * 1024 * 1024;
        Path source = directory.resolve("large.mp4");
        try (RandomAccessFile file = new RandomAccessFile(source.toFile(), "rw"))
        {
            file.write(new byte[]
            {0, 0, 0, 16, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'});
            file.setLength(size);
        }
        row.setExpectedSize(size);
        TelegramMedia claim = service.claimNext();
        when(client.downloadFile(5, claim.getReservedBytes()))
                .thenReturn(CompletableFuture.completedFuture(new TelegramDownloadedFile(source, size)));
        doAnswer(call -> {
            java.io.InputStream input = call.getArgument(1);
            assertThat(input.transferTo(java.io.OutputStream.nullOutputStream())).isEqualTo(size);
            return null;
        }).when(storage).write(anyString(), any(), eq(size), eq("video/mp4"));
        service.download(claim);
        assertThat(row.getStatus()).isEqualTo("AVAILABLE");
        assertThat(row.getActualSize()).isEqualTo(size);
        assertThat(row.getSha256()).hasSize(64);
    }

    @Test
    void renewsNearExpiryAndStillRejectsAnExpiredWorker()
    {
        service.claimNext();
        row.setLeaseExpiresAt(BusinessTime.now().plusMinutes(1));
        when(client.downloadFile(5, row.getReservedBytes())).thenReturn(
                CompletableFuture.completedFuture(new TelegramDownloadedFile(directory.resolve("video.mp4"), 12)));
        service.downloadWithTimeout(client, row);
        verify(states).renew(row);
        assertThat(row.getLeaseExpiresAt()).isAfter(BusinessTime.now().plusMinutes(9));
        row.setLeaseExpiresAt(BusinessTime.now().minusSeconds(1));
        assertThat(states.renew(row)).isFalse();
    }

    @Test
    void servesDownloadRangesAboveTwoGiBWithIndependentTicketAndAttachmentDisposition() throws Exception
    {
        row.setStatus("AVAILABLE");
        row.setActualSize(4L * 1024 * 1024 * 1024);
        row.setStorageProvider("LOCAL");
        row.setStorageKey("ab/test");
        row.setMediaType("video/mp4");
        row.setStreamTicketHash("existing-playback-digest");
        when(storage.openRange("ab/test", 3221225472L)).thenReturn(new ByteArrayInputStream(new byte[16]));
        var ticket = service.createDownloadTicket(1L);
        String secret = ticket.url().substring(ticket.url().indexOf("ticket=") + 7);
        var response = service.downloadContent(1L, secret, "bytes=3221225472-3221225487");
        assertThat(response.getStatusCode().value()).isEqualTo(206);
        assertThat(response.getHeaders().getFirst("Content-Range")).isEqualTo("bytes 3221225472-3221225487/4294967296");
        assertThat(response.getHeaders().getContentDisposition().getType()).isEqualTo("attachment");
        assertThat(row.getStreamTicketHash()).isEqualTo("existing-playback-digest");
        assertThat(response.getBody().getInputStream().readAllBytes()).hasSize(16);
        assertThatThrownBy(() -> service.downloadContent(1L, "x".repeat(43), null))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    }
}
