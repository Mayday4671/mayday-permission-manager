package com.mayday.common;

import java.util.Objects;
import org.springframework.dao.OptimisticLockingFailureException;

/** 业务编辑与删除共用的乐观锁检查；不接受缺失版本号，防止覆盖别人刚提交的数据。 */
public final class EntityVersions {
  private EntityVersions() {}

  public static void requireCurrent(BaseEntity entity, Long expectedVersion) {
    if (expectedVersion == null || !Objects.equals(entity.getVersion(), expectedVersion)) {
      throw new OptimisticLockingFailureException("记录版本已变化，请刷新后重试");
    }
  }
}
