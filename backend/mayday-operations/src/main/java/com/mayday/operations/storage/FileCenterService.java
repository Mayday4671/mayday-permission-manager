package com.mayday.operations.storage;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.FileUsage;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.FileDirectory;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.repository.FileDirectoryRepository;
import com.mayday.operations.repository.NotificationRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.security.AccessPolicy;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

/** 文件中心应用服务：统一所有者授权、目录规则、批量原子操作以及数据库与外部存储的补偿。 业务文件引用由各模块注册 FileUsage，文件中心不依赖业务表的具体实现。 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FileCenterService {
  private static final Set<String> ALLOWED_EXTENSIONS =
      Set.of("pdf", "txt", "csv", "png", "jpg", "jpeg", "webp", "docx", "xlsx", "zip");
  private static final Set<String> IMAGE_EXTENSIONS = Set.of("png", "jpg", "jpeg", "webp");
  private final StoredFileRepository files;
  private final FileDirectoryRepository directories;
  private final NotificationRepository notifications;
  private final List<FileUsage> businessReferences;
  private final AccessPolicy access;
  private final StorageSettings settings;
  private final StoredFileContent content;

  /** 所有者、目录和回收状态均在 SQL 分页前过滤，避免返回条数和总数泄露越权记录。 */
  @Transactional(readOnly = true)
  public PageResult<StoredFile> list(
      String keyword, Long directoryId, boolean deleted, int page, int size) {
    access.require("files:view");
    if (directoryId != null && directoryId > 0) directory(directoryId, false);
    return PageResult.from(
        files.findAll(
            (root, query, builder) -> {
              var ownership =
                  access.has("files:all")
                      ? builder.conjunction()
                      : builder.equal(root.get("ownerId"), access.current().getId());
              var location =
                  directoryId == null
                      ? builder.conjunction()
                      : directoryId == 0
                          ? builder.isNull(root.get("directoryId"))
                          : builder.equal(root.get("directoryId"), directoryId);
              return builder.and(
                  ownership,
                  location,
                  deleted
                      ? builder.isNotNull(root.get("deletedAt"))
                      : builder.isNull(root.get("deletedAt")),
                  SearchPredicates.contains(builder, root.get("name"), keyword));
            },
            PageResult.request(page, size)));
  }

  /** 单条操作复用列表的所有者边界，防止猜测文件 ID 绕过列表范围。 */
  @Transactional(readOnly = true)
  public StoredFile find(Long id) {
    return checkOwner(files.findById(id).orElseThrow(() -> new BusinessException("文件不存在")));
  }

  private StoredFile checkOwner(StoredFile file) {
    if (!access.has("files:all") && !Objects.equals(file.getOwnerId(), access.current().getId()))
      throw new AccessDeniedException("无权访问此文件");
    return file;
  }

  private FileDirectory directory(Long id, boolean lock) {
    var result =
        (lock ? directories.lock(id) : directories.findById(id))
            .orElseThrow(() -> new BusinessException("目录不存在"));
    if (!access.has("files:all") && !Objects.equals(result.getOwnerId(), access.current().getId()))
      throw new AccessDeniedException("无权访问此目录");
    return result;
  }

  /** 只读取授权目录元信息，单次最多五百个；文件移动不会改变文件或目录所有者。 */
  @Transactional(readOnly = true)
  public List<FileDirectory> directories() {
    access.require("files:view");
    return access.has("files:all")
        ? directories.findTop500ByOrderByNameAsc()
        : directories.findTop500ByOwnerIdOrderByNameAsc(access.current().getId());
  }

  /** 名称和父目录均来自已授权记录；数据库同级唯一约束负责阻止并发创建重复目录。 */
  @Transactional
  public FileDirectory saveDirectory(Long id, String name, Long parentId, Long version) {
    access.require(id == null ? "files:create" : "files:update");
    String normalizedName = name.strip();
    if (normalizedName.isBlank()
        || normalizedName.length() > 100
        || normalizedName
            .chars()
            .anyMatch(
                character ->
                    character == '/' || character == '\\' || Character.isISOControl(character)))
      throw new BusinessException("目录名不能为空或包含路径字符");
    FileDirectory value = id == null ? new FileDirectory() : directory(id, true);
    if (id != null) OperationSupport.version(value, version);
    Long ownerId = id == null ? access.current().getId() : value.getOwnerId();
    long targetParent = parentId == null ? 0 : parentId;
    if (targetParent > 0) {
      FileDirectory parent = directory(targetParent, true);
      if (!Objects.equals(parent.getOwnerId(), ownerId))
        throw new BusinessException("父目录与子目录必须属于同一用户");
      Set<Long> visited = new HashSet<>();
      while (parent != null) {
        if (!visited.add(parent.getId()) || Objects.equals(parent.getId(), id))
          throw new BusinessException("不能把目录移入自身或其子目录");
        parent = parent.getParentId() == 0 ? null : directory(parent.getParentId(), false);
      }
    }
    if (directories.existsByOwnerIdAndParentIdAndNameAndIdNot(
        ownerId, targetParent, normalizedName, id == null ? -1L : id))
      throw new BusinessException("同级目录中已存在此名称");
    if (id == null) {
      value.setOwnerId(ownerId);
      value.setOwnerName(access.current().getNickname());
    }
    value.setName(normalizedName);
    value.setParentId(targetParent);
    return directories.saveAndFlush(value);
  }

  /** 先锁定目录并检查提交版本，再验证包括回收文件在内的内容，防止与上传并发删除目录。 */
  @Transactional
  public void deleteDirectory(Long id, Long version) {
    access.require("files:delete");
    FileDirectory value = directory(id, true);
    OperationSupport.version(value, version);
    if (directories.existsByParentId(id) || files.existsByDirectoryId(id))
      throw new BusinessException("目录仍有子目录或文件（含回收文件），请先移动或清理");
    directories.delete(value);
  }

  /** 后端校验大小与实际图片格式，写入统一存储；事务回滚负责清理正文和缩略图对象。 */
  @Transactional(rollbackFor = IOException.class)
  public StoredFile upload(MultipartFile upload, Long directoryId) throws IOException {
    access.require("files:create");
    if (upload.isEmpty() || upload.getSize() > settings.maximumBytes())
      throw new BusinessException("文件大小须为 1 字节到 " + settings.maximumBytes() / 1024 / 1024 + " MB");
    FileDirectory target =
        directoryId == null || directoryId == 0 ? null : directory(directoryId, true);
    if (target != null && !Objects.equals(target.getOwnerId(), access.current().getId()))
      throw new BusinessException("上传文件只能选择本人目录");
    String name = safeName(upload.getOriginalFilename());
    String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    if (!ALLOWED_EXTENSIONS.contains(extension)) throw new BusinessException("不支持此文件类型");
    String mime = "application/octet-stream";
    byte[] thumbnail = null;
    if (IMAGE_EXTENSIONS.contains(extension)) {
      try (InputStream input = upload.getInputStream()) {
        mime = StoredFileContent.imageType(input.readNBytes(12));
      }
      try (InputStream input = upload.getInputStream()) {
        thumbnail = ImageThumbnail.create(input, mime);
      } catch (IOException exception) {
        throw new BusinessException("图片无法解析，请重新选择有效图片");
      }
    }
    StoredFile file = new StoredFile();
    file.setName(name);
    file.setContentType(mime);
    file.setSize(upload.getSize());
    file.setOwnerId(access.current().getId());
    file.setOwnerName(access.current().getNickname());
    file.setDirectoryId(target == null ? null : target.getId());
    file.setStorageProvider(settings.provider());
    file.setStorageKey(StorageKeys.create());
    FileStorage storage = content.storage(settings.provider());
    List<String> writtenKeys = new ArrayList<>();
    // 先登记补偿，数据库提交失败时同样会清理已写入的对象，而非只捕获方法内的异常。
    TransactionSynchronizationManager.registerSynchronization(
        new TransactionSynchronization() {
          @Override
          public void afterCompletion(int status) {
            if (status == STATUS_COMMITTED) return;
            for (String key : writtenKeys) {
              try {
                storage.delete(key);
              } catch (IOException exception) {
                log.warn("回滚上传后的存储清理失败，需要运维检查，文件标识 {}", file.getId());
              }
            }
          }
        });
    // 写入可能中途失败，预先登记键，以便存储实现成功了一部分时也能补偿。
    writtenKeys.add(file.getStorageKey());
    try (InputStream input = upload.getInputStream()) {
      storage.write(file.getStorageKey(), input, upload.getSize(), mime);
    }
    if (thumbnail != null) {
      file.setThumbnailKey(file.getStorageKey() + ".thumb.png");
      writtenKeys.add(file.getThumbnailKey());
      try (InputStream input = new ByteArrayInputStream(thumbnail)) {
        storage.write(file.getThumbnailKey(), input, thumbnail.length, "image/png");
      }
    }
    return files.saveAndFlush(file);
  }

  /** 提取用于展示和下载的文件名，去除目录与控制字符；此名称不参与存储对象键生成。 */
  public static String safeName(String original) {
    String name = Objects.toString(original, "file").replace('\\', '/');
    name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "");
    if (name.isBlank() || name.length() > 255) throw new BusinessException("文件名无效");
    return name;
  }

  private void unreferenced(StoredFile file) {
    if (notifications.existsByAttachmentIdsContains(file.getId())
        || businessReferences.stream().anyMatch(reference -> reference.referenced(file.getId())))
      throw new BusinessException("文件被业务记录引用，不能回收或永久删除");
  }

  /** 批量授权全部通过才修改，任何越权、引用或状态错误都会回滚整批。 永久删除只记录清理意图；后台任务成功清理后才移除元信息，失败记录可以在回收站查看。 */
  @Transactional
  public int batch(String action, List<Long> identifiers, Long directoryId) {
    String permission =
        switch (action) {
          case "MOVE" -> "files:update";
          case "RECYCLE" -> "files:delete";
          case "RESTORE" -> "files:restore";
          case "PURGE" -> "files:purge";
          default -> throw new BusinessException("文件批量操作无效");
        };
    access.require(permission);
    // 按 ID 固定锁顺序，两个批次包含相同文件时避免反向锁顺序引发死锁。
    List<Long> ordered = identifiers.stream().distinct().sorted().toList();
    if (ordered.isEmpty() || ordered.size() > 100)
      throw new BusinessException("一次操作须选择 1 到 100 个文件");
    FileDirectory target =
        "MOVE".equals(action) && directoryId != null && directoryId > 0
            ? directory(directoryId, true)
            : null;
    List<StoredFile> selected =
        ordered.stream()
            .map(
                identifier ->
                    checkOwner(
                        files.lock(identifier).orElseThrow(() -> new BusinessException("文件不存在"))))
            .toList();
    for (StoredFile file : selected) {
      if (file.getPurgeRequestedAt() != null) throw new BusinessException("文件正在永久清理，不能修改或恢复");
      if ("RESTORE".equals(action) || "PURGE".equals(action)) {
        if (file.getDeletedAt() == null) throw new BusinessException("只有回收站文件可以恢复或永久删除");
      } else if (file.getDeletedAt() != null) throw new BusinessException("请先恢复回收站文件");
      if ("RECYCLE".equals(action) || "PURGE".equals(action)) unreferenced(file);
      if (target != null && !Objects.equals(target.getOwnerId(), file.getOwnerId()))
        throw new BusinessException("文件只能移动到所属用户的目录");
    }
    LocalDateTime now = BusinessTime.now();
    for (StoredFile file : selected) {
      switch (action) {
        case "MOVE" -> file.setDirectoryId(target == null ? null : target.getId());
        case "RECYCLE" -> file.setDeletedAt(now);
        case "RESTORE" -> file.setDeletedAt(null);
        case "PURGE" -> {
          file.setPurgeRequestedAt(now);
          file.setPurgeError(null);
        }
        default -> throw new IllegalStateException("未经校验的文件操作");
      }
    }
    files.flush();
    return selected.size();
  }
}
