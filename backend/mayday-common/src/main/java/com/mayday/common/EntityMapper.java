package com.mayday.common;

import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryWrapper;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.dao.OptimisticLockingFailureException;

/**
 * 业务仓储门面：在 MyBatis-Flex 的 BaseMapper 之上保留项目统一的按主键读取与保存入口。
 *
 * <p>MyBatis-Flex 没有持久化上下文，保存即时执行：无主键走全字段插入（新实体版本从 0 开始）并回填生成键；
 * 有主键按整行更新（包括被业务显式清空的字段），版本列自动参与乐观锁。更新影响行数为 0 统一按版本冲突抛出， 更新成功后同步递增内存版本，同一事务内可以继续修改并再次保存，保持与 JPA
 * 时期相同的并发编辑语义。
 */
public interface EntityMapper<T extends BaseEntity> extends BaseMapper<T> {
  /** 按主键载入；缺失时返回空，由调用方决定抛出哪种业务异常。 */
  default Optional<T> findById(Serializable id) {
    return Optional.ofNullable(selectOneById(id));
  }

  /** 载入全部记录；大表必须改用带条件的分页查询，不允许无界读取。 */
  default List<T> findAll() {
    return selectListByQuery(QueryWrapper.create());
  }

  /** 按主键集合载入；结果顺序不保证，缺失的主键由调用方校验数量。 */
  default List<T> findAllById(Iterable<Long> ids) {
    List<Long> collected = new ArrayList<>();
    ids.forEach(collected::add);
    return collected.isEmpty() ? List.of() : selectListByIds(collected);
  }

  /** 主键存在性检查；行级范围与动作权限仍由业务入口判断，不能用存在性替代授权。 */
  default boolean existsById(Serializable id) {
    return selectOneById(id) != null;
  }

  /** 统计全表行数；仅用于管理场景，业务列表必须分页。 */
  default long count() {
    return selectCountByQuery(QueryWrapper.create());
  }

  /** 统一保存：插入或整行更新；版本过期抛冲突，成功后回写递增版本。 */
  default <S extends T> S save(S entity) {
    if (entity.getId() == null) {
      if (entity.getVersion() == null) entity.setVersion(0L);
      insert(entity);
    } else {
      if (update(entity, false) == 0) throw new OptimisticLockingFailureException("版本冲突");
      entity.setVersion(entity.getVersion() + 1);
    }
    return entity;
  }

  /** 批量保存逐条执行，保持版本检查与审计监听器语义；超大批量导入必须走专用通道。 */
  default <S extends T> List<S> saveAll(Iterable<S> entities) {
    List<S> saved = new ArrayList<>();
    entities.forEach(entity -> saved.add(save(entity)));
    return saved;
  }
}
