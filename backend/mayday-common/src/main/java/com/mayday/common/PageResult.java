package com.mayday.common;

import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

/** 前端统一使用从 1 开始的分页；限制每页最多 100 条，避免无界列表查询。 */
public record PageResult<T>(List<T> items, long total, int page, int size) {
  public static <T> PageResult<T> from(Page<T> data) {
    return new PageResult<>(
        data.getContent(), data.getTotalElements(), data.getNumber() + 1, data.getSize());
  }

  public static PageRequest request(int page, int size) {
    return PageRequest.of(
        Math.max(0, page - 1),
        Math.min(100, Math.max(1, size)),
        Sort.by(Sort.Direction.DESC, "id"));
  }
}
