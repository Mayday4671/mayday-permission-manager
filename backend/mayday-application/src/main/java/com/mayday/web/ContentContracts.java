package com.mayday.web;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.Set;

/** 内容编辑和发布是两个契约。旧 published 字段只保留显式兼容，新的编辑器不通过保存暗中发布。 */
public final class ContentContracts {
  private ContentContracts() {}

  /** 草稿修订的白名单输入。封面和附件只接受已获授权的受管文件 ID，HTML 将在服务端清洗； 可见范围、审批要求和旧 published 兼容项不能绕过独立发布权限与审批状态检查。 */
  @Schema(name = "ContentDraft")
  public record Draft(
      @NotBlank @Size(max = 160) String title,
      Long categoryId,
      @Size(max = 32) String category,
      @Size(max = 500) String summary,
      @NotBlank @Size(max = 50000) String content,
      @Pattern(regexp = "HTML|TEXT") String contentFormat,
      @Size(max = 10) Set<@NotNull Long> tagIds,
      @Size(max = 10) Set<@NotBlank @Size(max = 32) String> tags,
      @Pattern(regexp = "PUBLIC|INTERNAL") String visibility,
      Long coverId,
      @Size(max = 8) Set<@NotNull Long> attachmentIds,
      @Min(0) @Max(9999) Integer sortOrder,
      Boolean pinned,
      Boolean recommended,
      @Size(max = 160) String seoTitle,
      @Size(max = 250) String seoKeywords,
      @Size(max = 500) String seoDescription,
      Boolean requiresApproval,
      Boolean published,
      Long version) {}

  /** 发布指定修订及生效/下线时间；主记录 version 防止发布过期草稿或覆盖并发发布操作。 */
  public record Publish(
      @NotNull Long version,
      @NotNull Long revisionId,
      LocalDateTime publishAt,
      LocalDateTime offlineAt) {}

  /** 下线、回收和恢复等状态操作仅携带当前版本，不接受隐式修改正文或作者。 */
  @Schema(name = "ContentVersion")
  public record Version(@NotNull Long version) {}
}
