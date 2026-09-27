package com.mayday.operations;

import com.mayday.common.BaseEntity;
import java.util.Objects;

/** 跨模块使用的版本检查；不依赖应用层的用户服务。关键词查询由公共 SearchPredicates 处理。 */
public final class OperationSupport {
  private OperationSupport() {}

  public static void version(BaseEntity entity, Long version) {
    if (version == null || !Objects.equals(entity.getVersion(), version))
      throw new org.springframework.dao.OptimisticLockingFailureException("记录已更新，请刷新后重试");
  }
}
