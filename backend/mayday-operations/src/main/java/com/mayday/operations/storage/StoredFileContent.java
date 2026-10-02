package com.mayday.operations.storage;

import com.mayday.common.BusinessException;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.repository.FilePayloadRepository;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

/** 统一正文读取入口：文件中心、通知、审批和门户复用存储路由，不再直接假设正文在 MySQL。 本服务不授予访问权，调用方必须先验证所属业务；回收或待清理文件始终拒绝读取。 */
@Service
public class StoredFileContent {
  private final FilePayloadRepository payloads;
  private final List<FileStorage> storages;

  public StoredFileContent(FilePayloadRepository payloads, List<FileStorage> storages) {
    this.payloads = payloads;
    this.storages = List.copyOf(storages);
  }

  /** 按文件持久化的提供方路由，部署切换新上传模式后仍能读取之前存储的文件。 */
  public FileStorage storage(String provider) {
    return storages.stream()
        .filter(storage -> storage.provider().equals(provider))
        .findFirst()
        .orElseThrow(() -> new BusinessException("此文件的存储实现未启用"));
  }

  /** 调用者负责关闭流；MYSQL 兼容层仅加载当前文件，不影响文件列表查询。 */
  public InputStream open(StoredFile file) throws IOException {
    active(file);
    if ("MYSQL".equals(file.getStorageProvider()))
      return new ByteArrayInputStream(
          payloads
              .findById(file.getId())
              .orElseThrow(() -> new BusinessException("文件正文不存在"))
              .getData());
    return storage(file.getStorageProvider()).open(file.getStorageKey());
  }

  /** 在下载或业务关联前拒绝回收和清理中的文件，避免让不可用附件进入新业务记录。 */
  public static void active(StoredFile file) {
    if (file.getDeletedAt() != null || file.getPurgeRequestedAt() != null)
      throw new BusinessException("文件已回收，请先恢复后再使用");
  }

  /** 仅识别允许内联的栅格图片，原始文件扩展名或客户端 MIME 不能决定预览类型。 */
  public String imageType(StoredFile file) {
    try (InputStream input = open(file)) {
      return imageType(input.readNBytes(12));
    } catch (IOException exception) {
      throw new BusinessException("读取图片失败，请稍后重试");
    }
  }

  /** 根据实际字节签名识别 PNG、JPEG、WebP；HTML、SVG 和伪装扩展名不会获得内联预览。 */
  public static String imageType(byte[] bytes) {
    if (bytes.length >= 8
        && bytes[0] == (byte) 0x89
        && bytes[1] == 'P'
        && bytes[2] == 'N'
        && bytes[3] == 'G'
        && bytes[4] == 13
        && bytes[5] == 10
        && bytes[6] == 26
        && bytes[7] == 10) return "image/png";
    if (bytes.length >= 3
        && bytes[0] == (byte) 0xff
        && bytes[1] == (byte) 0xd8
        && bytes[2] == (byte) 0xff) return "image/jpeg";
    if (bytes.length >= 12
        && bytes[0] == 'R'
        && bytes[1] == 'I'
        && bytes[2] == 'F'
        && bytes[3] == 'F'
        && bytes[8] == 'W'
        && bytes[9] == 'E'
        && bytes[10] == 'B'
        && bytes[11] == 'P') return "image/webp";
    throw new BusinessException("仅支持有效 PNG、JPEG 或 WebP 图片预览");
  }

  /** 下载走流式响应并禁止嗅探；图片预览采用已核实的 MIME，其他格式始终作为附件下载。 */
  public ResponseEntity<Resource> response(StoredFile file, boolean image, boolean thumbnail) {
    active(file);
    try {
      String contentType = image ? imageType(file) : "application/octet-stream";
      boolean useThumbnail = image && thumbnail && file.getThumbnailKey() != null;
      InputStream stream =
          useThumbnail
              ? storage(file.getStorageProvider()).open(file.getThumbnailKey())
              : open(file);
      var disposition = image ? ContentDisposition.inline() : ContentDisposition.attachment();
      var response =
          ResponseEntity.ok()
              .cacheControl(CacheControl.noStore())
              .header("X-Content-Type-Options", "nosniff")
              .header("Content-Security-Policy", "default-src 'none'; sandbox")
              .header(
                  HttpHeaders.CONTENT_DISPOSITION,
                  disposition.filename(file.getName(), StandardCharsets.UTF_8).build().toString())
              .contentType(MediaType.parseMediaType(useThumbnail ? "image/png" : contentType));
      if (!useThumbnail) response.contentLength(file.getSize());
      // Spring 会在写出响应后关闭流，不能在此处提前使用 try-with-resources。
      return response.body(new InputStreamResource(stream));
    } catch (IOException exception) {
      throw new BusinessException("读取文件失败，请检查存储服务或稍后重试");
    }
  }
}
