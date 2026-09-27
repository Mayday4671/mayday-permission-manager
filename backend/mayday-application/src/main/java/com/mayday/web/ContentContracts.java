package com.mayday.web;

import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.Set;

/** 内容编辑和发布是两个契约。旧 published 字段只保留显式兼容，新的编辑器不通过保存暗中发布。 */
public final class ContentContracts {
  private ContentContracts() {}

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

  public record Publish(
      @NotNull Long version,
      @NotNull Long revisionId,
      LocalDateTime publishAt,
      LocalDateTime offlineAt) {}

  public record Version(@NotNull Long version) {}
}
