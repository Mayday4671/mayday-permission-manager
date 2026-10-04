package com.mayday.common;

import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

/** 前端统一使用从 1 开始的分页；限制每页最多 100 条，避免无界列表查询。 */
public record PageResult<T>(List<T> items, long total, int page, int size) {
  /** 将已经执行数据范围过滤的数据库分页转换为页面约定，保留总数并将页码改为从 1 开始。 */
  public static <T> PageResult<T> from(Page<T> data) {
    return new PageResult<>(
        data.getContent(), data.getTotalElements(), data.getNumber() + 1, data.getSize());
  }

  /** 规范化不可信分页参数并按主键倒序稳定排序；调用方仍需添加资源权限和行级范围条件。 */
  public static PageRequest request(int page, int size) {
    return PageRequest.of(
        Math.max(1, page) - 1,
        Math.min(100, Math.max(1, size)),
        Sort.by(Sort.Direction.DESC, "id"));
  }
}
