package com.mayday.telegram;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.Resource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Verifies ZIP path confinement, entry paging, bounded extraction and byte
 * ranges.
 */
class TelegramArchiveServiceTest
{
    @TempDir
    Path temporaryDirectory;

    private AccessPolicy access;
    private TelegramMediaMapper media;
    private TelegramCollectionTaskMapper tasks;
    private TelegramCollectedMessageMapper messages;
    private StoredFileContent storedFiles;
    private FileStorage storage;
    private SevenZipArchiveTool sevenZip;
    private TelegramArchiveService archives;

    @BeforeEach
    void setUp()
    {
        access = mock(AccessPolicy.class);
        media = mock(TelegramMediaMapper.class);
        tasks = mock(TelegramCollectionTaskMapper.class);
        messages = mock(TelegramCollectedMessageMapper.class);
        storedFiles = mock(StoredFileContent.class);
        storage = mock(FileStorage.class);
        sevenZip = mock(SevenZipArchiveTool.class);
        TelegramSettings settings = new TelegramSettings();
        settings.setDataDirectory(temporaryDirectory.resolve("telegram"));
        TelegramModuleGuard moduleGuard = mock(TelegramModuleGuard.class);
        archives = new TelegramArchiveService(moduleGuard, access, settings, media, tasks, messages, storedFiles,
                sevenZip);
    }

    @Test
    void listsOnlySafeEntriesAndPaginates()
    {
        prepareAvailableArchive(zip("images/cover.png", new byte[]
        {1, 2, 3}, "../outside.txt", new byte[]
        {9}));

        TelegramArchiveService.ArchivePage page = archives.entries(7L, 1, 1);

        assertThat(page.total()).isEqualTo(1);
        assertThat(page.items()).extracting(TelegramArchiveService.ArchiveEntryView::name)
                .containsExactly("images/cover.png");
    }

    @Test
    void extractsSelectedImageWithRangeAndDeletesTemporaryOutputOnClose() throws Exception
    {
        byte[] image = new byte[]
        {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 4, 5};
        prepareAvailableArchive(zip("pictures/photo.jpg", image));

        var response = archives.entry(7L, "pictures/photo.jpg", "bytes=1-3");
        Resource body = response.getBody();

        assertThat(response.getStatusCode().value()).isEqualTo(206);
        assertThat(response.getHeaders().getFirst("Content-Range")).isEqualTo("bytes 1-3/5");
        try (var input = body.getInputStream())
        {
            assertThat(input.readAllBytes()).containsExactly(image[1], image[2], image[3]);
        }
        try (var files = Files.list(temporaryDirectory.resolve("telegram")))
        {
            assertThat(files).isEmpty();
        }
    }

    @Test
    void rejectsTraversalNamesBeforeOpeningArchive()
    {
        assertThatThrownBy(() -> archives.entry(7L, "../outside.txt", null))
                .isInstanceOf(ResourceNotFoundException.class).hasMessageContaining("压缩包条目");
    }

    @Test
    void listsAndExtractsRarEntryThroughBoundedSevenZipAdapter() throws Exception
    {
        byte[] archiveSignature = new byte[]
        {'R', 'a', 'r', '!', 0x1a, 0x07, 0x01, 0x00};
        byte[] image = new byte[]
        {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 4, 5};
        prepareAvailableArchive(archiveSignature, "application/vnd.rar");
        when(sevenZip.list(org.mockito.ArgumentMatchers.any())).thenReturn(
                java.util.List.of(new SevenZipArchiveTool.ArchiveToolEntry("images/photo.jpg", 5, 0, false, false)));
        org.mockito.Mockito.when(sevenZip.extract(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq("images/photo.jpg"), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyLong())).thenAnswer(invocation -> {
                    Path output = invocation.getArgument(2);
                    Files.write(output, image);
                    return (long) image.length;
                });

        assertThat(archives.entries(7L, 1, 20).items()).extracting(TelegramArchiveService.ArchiveEntryView::name)
                .containsExactly("images/photo.jpg");
        var response = archives.entry(7L, "images/photo.jpg", null);
        try (var input = response.getBody().getInputStream())
        {
            assertThat(input.readAllBytes()).containsExactly(image);
        }
    }

    @Test
    void parsesEncryptedAndSymbolicLinkMetadataWithoutMarkingThemExtractable()
    {
        String listing = "7-Zip 24.09\n----------\n"
                + "Path = private.bin\nFolder = -\nSize = 17\nEncrypted = +\nAttributes = A\n\n"
                + "Path = linked.bin\nFolder = -\nSize = 1\nEncrypted = -\nSymbolic Link = target.bin\n";

        List<SevenZipArchiveTool.ArchiveToolEntry> entries = SevenZipArchiveTool.parseListing(listing);

        assertThat(entries).hasSize(2);
        assertThat(entries.get(0).encrypted()).isTrue();
        assertThat(entries.get(1).symbolicLink()).isTrue();
    }

    private void prepareAvailableArchive(byte[] zip)
    {
        prepareAvailableArchive(zip, "application/zip");
    }

    private void prepareAvailableArchive(byte[] zip, String mediaType)
    {
        TelegramMedia source = new TelegramMedia();
        source.setId(7L);
        source.setOwnerId(1L);
        source.setDepartmentId(2L);
        source.setTaskId(8L);
        source.setMessageId(9L);
        source.setKind("DOCUMENT");
        source.setStatus("AVAILABLE");
        source.setMediaType(mediaType);
        source.setStorageProvider("TEST");
        source.setStorageKey("object");
        source.setActualSize((long) zip.length);

        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setId(8L);
        task.setOwnerId(1L);
        task.setDepartmentId(2L);
        task.setDownloadDocuments(true);
        TelegramCollectedMessage message = new TelegramCollectedMessage();
        message.setId(9L);
        message.setOwnerId(1L);
        message.setDepartmentId(2L);
        message.setTaskId(8L);
        message.setCanBeSaved(true);

        when(media.findById(7L)).thenReturn(java.util.Optional.of(source));
        when(tasks.findById(8L)).thenReturn(java.util.Optional.of(task));
        when(messages.findById(9L)).thenReturn(java.util.Optional.of(message));
        when(storedFiles.storage("TEST")).thenReturn(storage);
        try
        {
            when(storage.open("object")).thenAnswer(ignored -> new ByteArrayInputStream(zip));
        } catch (java.io.IOException exception)
        {
            throw new IllegalStateException(exception);
        }
    }

    private byte[] zip(Object... nameAndContent)
    {
        try
        {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (ZipOutputStream output = new ZipOutputStream(bytes))
            {
                for (int index = 0; index < nameAndContent.length; index += 2)
                {
                    output.putNextEntry(new ZipEntry((String) nameAndContent[index]));
                    output.write((byte[]) nameAndContent[index + 1]);
                    output.closeEntry();
                }
            }
            return bytes.toByteArray();
        } catch (java.io.IOException exception)
        {
            throw new IllegalStateException(exception);
        }
    }
}
