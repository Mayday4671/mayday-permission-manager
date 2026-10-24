package com.mayday.telegram;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

import com.mayday.common.exception.BusinessException;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.mapper.TelegramCollectedMessageMapper;
import com.mayday.telegram.mapper.TelegramCollectionTaskMapper;
import com.mayday.telegram.mapper.TelegramMediaMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 使用真实 7-Zip 验证进程参数、目录解析、提取内容和临时文件生命周期，不连接数据库或 Telegram。 通过
 * telegram.test.sevenZipPath 显式指定可执行文件后启用；RAR 验收另外指定 telegram.test.rarPath。
 * 归档内容仅读取并比较字节，不运行任何提取出的文件。
 */
@EnabledIfSystemProperty(named = "telegram.test.sevenZipPath", matches = ".+")
@Timeout(60)
class TelegramSevenZipIntegrationTest
{
    private static final String TEXT_ENTRY = "docs/说明 文档.txt";
    private static final String IMAGE_ENTRY = "images/cover.png";
    private static final byte[] TEXT = "Mayday archive acceptance\n中文说明\n".getBytes(StandardCharsets.UTF_8);
    private static final byte[] IMAGE = Base64.getDecoder()
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ9sAAAAASUVORK5CYII=");
    private static final String RAR_SHA256 = "d421b86f6290aefad61b2a36737253b2b30fe27c156bd95abfc230f24fe0307e";

    @TempDir
    Path temporaryDirectory;

    private TelegramSettings settings;
    private SevenZipArchiveTool sevenZip;
    private Path runtimeDirectory;

    @BeforeEach
    void setUp()
    {
        Path executable = Path.of(System.getProperty("telegram.test.sevenZipPath")).toAbsolutePath().normalize();
        assertThat(executable).isRegularFile();
        runtimeDirectory = temporaryDirectory.resolve("runtime");
        settings = new TelegramSettings();
        settings.setSevenZipPath(executable.toString());
        settings.setDataDirectory(runtimeDirectory);
        sevenZip = new SevenZipArchiveTool(settings);
    }

    @Test
    void listsAndExtractsRealSevenZipArchiveWithNestedUnicodePaths() throws Exception
    {
        Path archive = createSevenZipArchive();

        List<SevenZipArchiveTool.ArchiveToolEntry> entries = sevenZip.list(archive);

        assertThat(entries).extracting(SevenZipArchiveTool.ArchiveToolEntry::name).containsExactlyInAnyOrder(TEXT_ENTRY,
                IMAGE_ENTRY);
        assertThat(entries).allSatisfy(entry -> {
            assertThat(entry.encrypted()).isFalse();
            assertThat(entry.symbolicLink()).isFalse();
            assertThat(entry.modifiedAt()).isGreaterThan(0);
        });
        Path output = temporaryDirectory.resolve("decoded.bin");
        assertThat(sevenZip.extract(archive, TEXT_ENTRY, output, 1_024)).isEqualTo(TEXT.length);
        assertThat(Files.readAllBytes(output)).containsExactly(TEXT);
        assertToolTemporaryFilesRemoved();
    }

    @Test
    void pagesRealEntriesAndCleansStagingAndExtractedImageOnClose() throws Exception
    {
        TelegramArchiveService service = archiveService(createSevenZipArchive(), "application/x-7z-compressed");

        var firstPage = service.entries(7L, 1, 1);
        var secondPage = service.entries(7L, 2, 1);

        assertThat(firstPage.total()).isEqualTo(2);
        assertThat(firstPage.items()).hasSize(1);
        assertThat(secondPage.items()).hasSize(1);
        assertThat(firstPage.items().get(0).name()).isNotEqualTo(secondPage.items().get(0).name());
        assertRuntimeDirectoryEmpty();

        var response = service.entry(7L, IMAGE_ENTRY, "bytes=1-8");
        assertThat(response.getStatusCode().value()).isEqualTo(206);
        assertThat(response.getHeaders().getContentLength()).isEqualTo(8);
        assertThat(response.getHeaders().getFirst("Content-Range")).isEqualTo("bytes 1-8/" + IMAGE.length);
        assertThat(response.getHeaders().getContentType().toString()).isEqualTo("image/png");
        try (var paths = Files.list(runtimeDirectory))
        {
            assertThat(paths.toList()).singleElement()
                    .satisfies(path -> assertThat(path.getFileName().toString()).startsWith("telegram-entry-"));
        }
        try (var input = response.getBody().getInputStream())
        {
            assertThat(input.readAllBytes()).containsExactly(java.util.Arrays.copyOfRange(IMAGE, 1, 9));
        }
        assertRuntimeDirectoryEmpty();
    }

    @Test
    void invalidRangeLeavesNoStagedOrExtractedFiles() throws Exception
    {
        TelegramArchiveService service = archiveService(createSevenZipArchive(), "application/x-7z-compressed");

        var response = service.entry(7L, IMAGE_ENTRY, "bytes=99999-");

        assertThat(response.getStatusCode().value()).isEqualTo(416);
        assertThat(response.getBody()).isNull();
        assertRuntimeDirectoryEmpty();
    }

    @Test
    void extractionLimitAndCorruptArchiveFailuresCleanToolAndServiceTemporaryFiles() throws Exception
    {
        Path archive = createSevenZipArchive();
        Path output = temporaryDirectory.resolve("bounded-output.bin");
        assertThatThrownBy(() -> sevenZip.extract(archive, TEXT_ENTRY, output, 1)).isInstanceOf(BusinessException.class)
                .hasMessageContaining("超过单文件限制");
        assertToolTemporaryFilesRemoved();

        Path corruptArchive = temporaryDirectory.resolve("corrupt.7z");
        byte[] bytes = Files.readAllBytes(archive);
        Files.write(corruptArchive, java.util.Arrays.copyOf(bytes, 12));
        TelegramArchiveService service = archiveService(corruptArchive, "application/x-7z-compressed");

        assertThatThrownBy(() -> service.entries(7L, 1, 20)).isInstanceOf(BusinessException.class)
                .hasMessageContaining("无法安全读取");
        assertRuntimeDirectoryEmpty();
    }

    /**
     * 使用 libarchive 官方固定样例中的两个纯文本条目，并验证其 Unix 符号链接不会暴露给调用方。
     * 样例来源：libarchive/libarchive@b0c54adc05e67505aba443f08ae961f526ceb134，
     * libarchive/test/test_read_format_rar.rar.uu；解码后为 336 字节，SHA-256 固定校验。
     */
    @Test
    @EnabledIfSystemProperty(named = "telegram.test.rarPath", matches = ".+")
    void listsAndExtractsOfficialRarTextFixtureWithRealSevenZip() throws Exception
    {
        Path fixture = Path.of(System.getProperty("telegram.test.rarPath")).toAbsolutePath().normalize();
        byte[] archiveBytes = Files.readAllBytes(fixture);
        assertThat(archiveBytes).hasSize(336);
        assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(archiveBytes)))
                .isEqualTo(RAR_SHA256);
        Path archive = temporaryDirectory.resolve("official-text.rar");
        Files.write(archive, archiveBytes);

        List<SevenZipArchiveTool.ArchiveToolEntry> entries = sevenZip.list(archive);
        assertThat(entries).filteredOn(entry -> entry.name().equals("testlink")).singleElement()
                .satisfies(entry -> assertThat(entry.symbolicLink()).isTrue());
        assertToolTemporaryFilesRemoved();

        TelegramArchiveService service = archiveService(archive, "application/vnd.rar");
        assertThat(service.entries(7L, 1, 20).items()).extracting(TelegramArchiveService.ArchiveEntryView::name)
                .containsExactlyInAnyOrder("test.txt", "testdir/test.txt");
        assertRuntimeDirectoryEmpty();

        var response = service.entry(7L, "testdir/test.txt", null);
        assertThat(response.getHeaders().getContentLength()).isEqualTo(20);
        assertThat(response.getHeaders().getContentDisposition().getType()).isEqualTo("attachment");
        try (var input = response.getBody().getInputStream())
        {
            assertThat(new String(input.readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("test text document\r\n");
        }
        assertRuntimeDirectoryEmpty();
    }

    /** 在隔离目录生成小型 7z 文件，参数直传工具，不经过 shell。 */
    private Path createSevenZipArchive() throws Exception
    {
        Path sources = Files.createDirectories(temporaryDirectory.resolve("input"));
        Files.createDirectories(sources.resolve("docs"));
        Files.createDirectories(sources.resolve("images"));
        Files.write(sources.resolve(TEXT_ENTRY), TEXT);
        Files.write(sources.resolve(IMAGE_ENTRY), IMAGE);
        Path archive = temporaryDirectory.resolve("sample.7z");
        Path log = temporaryDirectory.resolve("creation.log");
        Process process = new ProcessBuilder(settings.getSevenZipPath(), "a", "-t7z", "-y", "-bd", archive.toString(),
                "docs", "images").directory(sources.toFile()).redirectErrorStream(true).redirectOutput(log.toFile())
                .start();
        try
        {
            assertThat(process.waitFor(20, TimeUnit.SECONDS)).as("7-Zip 样例创建应在超时前结束").isTrue();
            assertThat(process.exitValue()).as(Files.readString(log)).isZero();
        } finally
        {
            if (process.isAlive())
            {
                process.destroyForcibly();
            }
        }
        return archive;
    }

    /** 只替换数据库和对象存储边界；归档识别、真实工具调用和返回流保持生产实现。 */
    private TelegramArchiveService archiveService(Path archive, String mediaType) throws IOException
    {
        byte[] bytes = Files.readAllBytes(archive);
        TelegramMediaMapper media = mock(TelegramMediaMapper.class);
        TelegramCollectionTaskMapper tasks = mock(TelegramCollectionTaskMapper.class);
        TelegramCollectedMessageMapper messages = mock(TelegramCollectedMessageMapper.class);
        StoredFileContent storedFiles = mock(StoredFileContent.class);
        FileStorage storage = mock(FileStorage.class);
        TelegramMedia attachment = new TelegramMedia();
        attachment.setId(7L);
        attachment.setTaskId(8L);
        attachment.setMessageId(9L);
        attachment.setOwnerId(1L);
        attachment.setDepartmentId(2L);
        attachment.setKind("DOCUMENT");
        attachment.setStatus("AVAILABLE");
        attachment.setMediaType(mediaType);
        attachment.setStorageProvider("TEST");
        attachment.setStorageKey("archive-object");
        attachment.setActualSize((long) bytes.length);
        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setId(8L);
        task.setOwnerId(1L);
        task.setDepartmentId(2L);
        task.setDownloadDocuments(true);
        TelegramCollectedMessage message = new TelegramCollectedMessage();
        message.setId(9L);
        message.setTaskId(8L);
        message.setOwnerId(1L);
        message.setDepartmentId(2L);
        message.setCanBeSaved(true);
        when(media.findById(7L)).thenReturn(Optional.of(attachment));
        when(tasks.findById(8L)).thenReturn(Optional.of(task));
        when(messages.findById(9L)).thenReturn(Optional.of(message));
        when(storedFiles.storage("TEST")).thenReturn(storage);
        when(storage.open("archive-object")).thenAnswer(ignored -> new ByteArrayInputStream(bytes));
        return new TelegramArchiveService(mock(TelegramModuleGuard.class), mock(AccessPolicy.class), settings, media,
                tasks, messages, storedFiles, sevenZip);
    }

    private void assertRuntimeDirectoryEmpty() throws IOException
    {
        try (var paths = Files.list(runtimeDirectory))
        {
            assertThat(paths.toList()).isEmpty();
        }
    }

    private void assertToolTemporaryFilesRemoved() throws IOException
    {
        try (var paths = Files.list(temporaryDirectory))
        {
            assertThat(paths.map(path -> path.getFileName().toString()).toList())
                    .noneMatch(name -> name.startsWith("telegram-7z-"));
        }
    }
}
