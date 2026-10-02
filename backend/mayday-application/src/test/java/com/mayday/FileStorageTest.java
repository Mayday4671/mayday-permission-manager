package com.mayday;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.common.BusinessException;
import com.mayday.common.FileUsage;
import com.mayday.operations.model.FileDirectory;
import com.mayday.operations.model.FilePayload;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.repository.FileDirectoryRepository;
import com.mayday.operations.repository.FilePayloadRepository;
import com.mayday.operations.repository.NotificationRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.operations.storage.FileCenterService;
import com.mayday.operations.storage.FileStorage;
import com.mayday.operations.storage.ImageThumbnail;
import com.mayday.operations.storage.LocalFileStorage;
import com.mayday.operations.storage.S3FileStorage;
import com.mayday.operations.storage.StorageKeys;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.sun.net.httpserver.HttpServer;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/** 存储边界、旧数据兼容和文件所有者授权测试；目录唯一键和业务引用行锁另外走真实 MySQL 验收。 */
class FileStorageTest {
  @TempDir Path temporary;

  private StorageSettings settings() {
    return new StorageSettings("LOCAL", temporary.toString(), 10, "", "us-east-1", "", "", "");
  }

  @Test
  void localStorageRejectsPathTraversalAndIncompleteWrites() throws IOException {
    LocalFileStorage storage = new LocalFileStorage(settings());
    assertThrows(IllegalArgumentException.class, () -> storage.open("../../outside.txt"));
    String key = StorageKeys.create();
    byte[] bytes = "流式存储".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    storage.write(key, new ByteArrayInputStream(bytes), bytes.length, "text/plain");
    try (var input = storage.open(key)) {
      assertArrayEquals(bytes, input.readAllBytes());
    }
    storage.delete(key);
    storage.delete(key);
    assertFalse(Files.exists(temporary.resolve(key)));
    String incomplete = StorageKeys.create();
    assertThrows(
        IOException.class,
        () ->
            storage.write(
                incomplete, new ByteArrayInputStream(bytes), bytes.length + 1, "text/plain"));
    assertFalse(Files.exists(temporary.resolve(incomplete)));
  }

  @Test
  void deploymentSettingsRejectInvalidModeLimitAndS3Credentials() {
    assertThrows(
        IllegalArgumentException.class,
        () -> new StorageSettings("PUBLIC", ".", 10, "", "", "", "", ""));
    assertThrows(
        IllegalArgumentException.class,
        () -> new StorageSettings("LOCAL", ".", 101, "", "", "", "", ""));
    assertThrows(
        IllegalArgumentException.class,
        () -> new StorageSettings("S3", ".", 10, "", "region", "bucket", "", ""));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new StorageSettings(
                "S3",
                ".",
                10,
                "https://key:secret@example.org/path",
                "region",
                "bucket",
                "key",
                "secret"));
    for (String endpoint :
        List.of(
            "ftp://example.org",
            "https://example.org/path",
            "https://example.org?token=secret",
            "https://example.org#secret",
            "https://"))
      assertThrows(
          IllegalArgumentException.class,
          () -> new StorageSettings("S3", ".", 10, endpoint, "region", "bucket", "key", "secret"));
  }

  @Test
  void s3RemoteErrorsDoNotLeakCredentialsOrRemoteBody() throws IOException {
    // 本地伪服务只检查 SDK 边界，不需要云账户，也不触碰部署中的桶或日常文件。
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String secret = "S3-test-secret-must-not-be-exposed";
    server.createContext(
        "/",
        exchange -> {
          exchange.getRequestBody().close();
          byte[] body =
              ("<Error><Code>AccessDenied</Code><Message>" + secret + "</Message></Error>")
                  .getBytes(java.nio.charset.StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/xml");
          exchange.sendResponseHeaders(403, body.length);
          try (var output = exchange.getResponseBody()) {
            output.write(body);
          }
        });
    server.start();
    S3FileStorage storage =
        new S3FileStorage(
            new StorageSettings(
                "S3",
                temporary.toString(),
                10,
                "http://127.0.0.1:" + server.getAddress().getPort(),
                "us-east-1",
                "test-bucket",
                "test-access-key",
                secret));
    try {
      String key = StorageKeys.create();
      IOException read = assertThrows(IOException.class, () -> storage.open(key));
      IOException write =
          assertThrows(
              IOException.class,
              () -> storage.write(key, new ByteArrayInputStream(new byte[] {1}), 1, "text/plain"));
      IOException delete = assertThrows(IOException.class, () -> storage.delete(key));
      for (IOException error : List.of(read, write, delete)) {
        assertFalse(error.getMessage().contains(secret));
        assertFalse(error.getMessage().contains("test-access-key"));
        assertNull(error.getCause());
      }
    } finally {
      storage.close();
      server.stop(0);
    }
  }

  @Test
  void legacyMysqlBytesRemainReadableAndKeysNeverSerialize() throws IOException {
    FilePayloadRepository payloads = mock(FilePayloadRepository.class);
    FilePayload payload = new FilePayload();
    payload.setId(7L);
    payload.setData(new byte[] {1, 2, 3});
    when(payloads.findById(7L)).thenReturn(Optional.of(payload));
    StoredFile file = file(7L, 1L);
    file.setStorageKey("must-not-leak");
    file.setThumbnailKey("must-not-leak-thumbnail");
    StoredFileContent content = new StoredFileContent(payloads, List.of());
    try (var input = content.open(file)) {
      assertArrayEquals(payload.getData(), input.readAllBytes());
    }
    String json = JsonMapper.builder().build().writeValueAsString(file);
    assertFalse(json.contains("must-not-leak"));
    assertFalse(json.contains("storageKey"));
    file.setDeletedAt(LocalDateTime.now());
    assertThrows(BusinessException.class, () -> content.open(file));
  }

  @Test
  void thumbnailPreservesAspectRatioAndInlineTypeComesFromBytes() throws IOException {
    BufferedImage image = new BufferedImage(800, 400, BufferedImage.TYPE_INT_RGB);
    ByteArrayOutputStream encoded = new ByteArrayOutputStream();
    ImageIO.write(image, "png", encoded);
    assertEquals("image/png", StoredFileContent.imageType(encoded.toByteArray()));
    byte[] thumbnail =
        ImageThumbnail.create(new ByteArrayInputStream(encoded.toByteArray()), "image/png");
    BufferedImage resized = ImageIO.read(new ByteArrayInputStream(thumbnail));
    assertEquals(320, resized.getWidth());
    assertEquals(160, resized.getHeight());
    assertThrows(
        BusinessException.class,
        () -> StoredFileContent.imageType("<script>bad()</script>".getBytes()));
  }

  @Test
  void batchWithForeignOwnerDoesNotModifyAnySelectedFile() {
    Fixture fixture = new Fixture();
    StoredFile own = file(1L, 5L), other = file(2L, 6L);
    when(fixture.files.lock(1L)).thenReturn(Optional.of(own));
    when(fixture.files.lock(2L)).thenReturn(Optional.of(other));
    assertThrows(
        AccessDeniedException.class, () -> fixture.service.batch("RECYCLE", List.of(2L, 1L), null));
    assertNull(own.getDeletedAt());
    assertNull(other.getDeletedAt());
    verify(fixture.files, never()).flush();
  }

  @Test
  void referencedFileCannotBeRecycledAndPurgingFileCannotBeRestored() {
    Fixture fixture = new Fixture();
    StoredFile file = file(1L, 5L);
    when(fixture.files.lock(1L)).thenReturn(Optional.of(file));
    when(fixture.usage.referenced(1L)).thenReturn(true);
    assertThrows(
        BusinessException.class, () -> fixture.service.batch("RECYCLE", List.of(1L), null));
    assertNull(file.getDeletedAt());
    file.setDeletedAt(LocalDateTime.now());
    file.setPurgeRequestedAt(LocalDateTime.now());
    assertThrows(
        BusinessException.class, () -> fixture.service.batch("RESTORE", List.of(1L), null));
    assertTrue(file.getDeletedAt() != null);
  }

  @Test
  void directoryMoveCannotCreateCyclesOrChangeOwner() {
    Fixture fixture = new Fixture();
    FileDirectory parent = directory(1L, 0L, 5L), child = directory(2L, 1L, 5L);
    when(fixture.directories.lock(1L)).thenReturn(Optional.of(parent));
    when(fixture.directories.lock(2L)).thenReturn(Optional.of(child));
    when(fixture.directories.findById(1L)).thenReturn(Optional.of(parent));
    assertThrows(
        BusinessException.class, () -> fixture.service.saveDirectory(1L, "parent", 2L, 0L));
    assertEquals(0L, parent.getParentId());
    child.setOwnerId(6L);
    assertThrows(
        AccessDeniedException.class, () -> fixture.service.saveDirectory(1L, "parent", 2L, 0L));
  }

  @Test
  void failedDatabaseSaveRegistersStorageCompensation() throws IOException {
    Fixture fixture = new Fixture();
    FileStorage storage = mock(FileStorage.class);
    when(storage.provider()).thenReturn("LOCAL");
    StoredFileContent content =
        new StoredFileContent(mock(FilePayloadRepository.class), List.of(storage));
    FileCenterService service = fixture.withContent(content);
    when(fixture.files.saveAndFlush(any()))
        .thenThrow(new IllegalStateException("database rejected"));
    TransactionSynchronizationManager.initSynchronization();
    try {
      assertThrows(
          IllegalStateException.class,
          () ->
              service.upload(
                  new MockMultipartFile("file", "proof.txt", "text/plain", new byte[] {1, 2}),
                  null));
      for (var synchronization : TransactionSynchronizationManager.getSynchronizations())
        synchronization.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
      verify(storage).delete(any());
    } finally {
      TransactionSynchronizationManager.clearSynchronization();
    }
  }

  private static StoredFile file(Long id, Long ownerId) {
    StoredFile file = new StoredFile();
    file.setId(id);
    file.setOwnerId(ownerId);
    file.setName("proof.txt");
    file.setContentType("application/octet-stream");
    file.setSize(3);
    return file;
  }

  private static FileDirectory directory(Long id, Long parentId, Long ownerId) {
    FileDirectory directory = new FileDirectory();
    directory.setId(id);
    directory.setParentId(parentId);
    directory.setOwnerId(ownerId);
    directory.setVersion(0L);
    return directory;
  }

  /** 只模拟授权与仓库边界，不用测试绕过真实生产登录或修改日常数据库。 */
  private class Fixture {
    private final StoredFileRepository files = mock(StoredFileRepository.class);
    private final FileDirectoryRepository directories = mock(FileDirectoryRepository.class);
    private final NotificationRepository notifications = mock(NotificationRepository.class);
    private final FileUsage usage = mock(FileUsage.class);
    private final AccessPolicy access = mock(AccessPolicy.class);
    private final FileCenterService service;

    Fixture() {
      SysUser user = new SysUser();
      user.setId(5L);
      user.setNickname("测试用户");
      when(access.current()).thenReturn(user);
      when(usage.referenced(anyLong())).thenReturn(false);
      service = withContent(mock(StoredFileContent.class));
    }

    private FileCenterService withContent(StoredFileContent content) {
      return new FileCenterService(
          files, directories, notifications, List.of(usage), access, settings(), content);
    }
  }
}
