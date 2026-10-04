package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import com.mayday.operations.model.FileDirectory;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.storage.FileCenterService;
import com.mayday.operations.storage.StorageSettings;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.security.AccessPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** 文件中心接口只暴露业务元信息，存储路径、对象键和凭据不属于客户端契约。 文件与业务附件保持同一鉴权入口，目录、批量操作和回收站均由应用服务再次验证所有者。 */
@RestController
@RequestMapping("/api/operations/files")
@RequiredArgsConstructor
public class FileController {
  private final FileCenterService service;
  private final StoredFileContent content;
  private final StorageSettings settings;
  private final AccessPolicy access;

  /** 上传上限以服务端部署配置为准，前端不需要得知磁盘路径或对象存储地址。 */
  public record StorageInfo(String provider, long maximumBytes, List<String> extensions) {}

  /** 目录编辑请求；父目录零值表示根目录，更新必须携带版本以检测并发编辑。 */
  public record DirectoryEdit(
      @NotBlank @Size(max = 100) String name, @PositiveOrZero Long parentId, Long version) {}

  /** 同批文件必须全部通过授权与状态检查，单次最多一百条，目录参数仅用于移动。 */
  public record BatchEdit(
      @NotBlank String action,
      @NotNull @Size(min = 1, max = 100) List<@NotNull @Positive Long> ids,
      @PositiveOrZero Long directoryId) {}

  /** 返回已通过整批原子校验的记录数；永久清理实际完成状态由回收站列表查询。 */
  public record BatchResult(int count) {}

  /** 分页查询已授权文件，支持目录和回收状态；不序列化底层存储键或正文。 */
  @GetMapping
  public ApiResponse<PageResult<StoredFile>> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Long directoryId,
      @RequestParam(defaultValue = "false") boolean deleted,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(service.list(keyword, directoryId, deleted, page, size));
  }

  /** 按 ID 查询经过所有者校验的元信息，供详情及后台永久清理进度核对，不读取文件正文。 */
  @GetMapping("/{id}")
  public ApiResponse<StoredFile> detail(@PathVariable Long id) {
    access.require("files:view");
    return ApiResponse.ok(service.find(id));
  }

  /** 提供上传类型和限额，省去前端重复配置；凭据和存储地址仅保留在服务端。 */
  @GetMapping("/storage-info")
  public ApiResponse<StorageInfo> storageInfo() {
    access.require("files:view");
    return ApiResponse.ok(
        new StorageInfo(
            settings.provider(),
            settings.maximumBytes(),
            List.of("pdf", "txt", "csv", "png", "jpg", "jpeg", "webp", "docx", "xlsx", "zip")));
  }

  /** 获取当前用户可访问的目录元信息，用于构建目录选择器和目录管理表。 */
  @GetMapping("/directories")
  public ApiResponse<List<FileDirectory>> directories() {
    return ApiResponse.ok(service.directories());
  }

  /** 在本人目录树下新建目录，父目录和同级名称由应用服务重新验证。 */
  @PostMapping("/directories")
  public ApiResponse<FileDirectory> createDirectory(@Valid @RequestBody DirectoryEdit request) {
    return ApiResponse.ok(service.saveDirectory(null, request.name(), request.parentId(), null));
  }

  /** 修改目录名称或层级，使用提交版本拒绝覆盖他人已保存的变更。 */
  @PutMapping("/directories/{id}")
  public ApiResponse<FileDirectory> updateDirectory(
      @PathVariable Long id, @Valid @RequestBody DirectoryEdit request) {
    return ApiResponse.ok(
        service.saveDirectory(id, request.name(), request.parentId(), request.version()));
  }

  /** 仅删除版本一致的空目录；子目录和回收文件同样视为目录内容。 */
  @DeleteMapping("/directories/{id}")
  public ApiResponse<Void> deleteDirectory(@PathVariable Long id, @RequestParam Long version) {
    service.deleteDirectory(id, version);
    return ApiResponse.ok(null);
  }

  /** 接收受限文件流并写入部署指定的存储，数据库失败时补偿已写入对象。 */
  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiResponse<StoredFile> upload(
      @RequestPart("file") MultipartFile upload, @RequestParam(required = false) Long directoryId)
      throws IOException {
    return ApiResponse.ok(service.upload(upload, directoryId));
  }

  /** 文件所有者和下载权限均验证后流式下载，禁止浏览器按文件内容推测可执行类型。 */
  @GetMapping("/{id}/download")
  public ResponseEntity<Resource> download(@PathVariable Long id) {
    access.require("files:download");
    return content.response(service.find(id), false, false);
  }

  /** 仅预览经字节签名确认的安全栅格图片，其他文件类型不会作为网页执行。 */
  @GetMapping("/{id}/preview")
  public ResponseEntity<Resource> preview(@PathVariable Long id) {
    access.require("files:download");
    return content.response(service.find(id), true, false);
  }

  /** 经与原图相同的鉴权读取缩略图，无缩略图时使用已验证的原始图片。 */
  @GetMapping("/{id}/thumbnail")
  public ResponseEntity<Resource> thumbnail(@PathVariable Long id) {
    access.require("files:download");
    return content.response(service.find(id), true, true);
  }

  /** 保留已有 DELETE 地址兼容业务页面，但改为可恢复的回收，不立即销毁正文。 */
  @DeleteMapping("/{id}")
  public ApiResponse<Void> recycle(@PathVariable Long id) {
    service.batch("RECYCLE", List.of(id), null);
    return ApiResponse.ok(null);
  }

  /** 统一移动、回收、恢复和永久清理入口，应用服务校验每一条记录再修改整批。 */
  @PostMapping("/batch")
  public ApiResponse<BatchResult> batch(@Valid @RequestBody BatchEdit request) {
    return ApiResponse.ok(
        new BatchResult(service.batch(request.action(), request.ids(), request.directoryId())));
  }
}
