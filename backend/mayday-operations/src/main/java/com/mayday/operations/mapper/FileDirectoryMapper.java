package com.mayday.operations.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.FileDirectory;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 目录树查询限制条数；移动和删除锁定目标目录，防止上传与目录删除的竞态。 */
@Mapper
public interface FileDirectoryMapper extends EntityMapper<FileDirectory> {
  default List<FileDirectory> findTop500ByOwnerIdOrderByNameAsc(Long ownerId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("owner_id").eq(ownerId))
            .orderBy("name asc")
            .limit(500));
  }

  default List<FileDirectory> findTop500ByOrderByNameAsc() {
    return selectListByQuery(QueryWrapper.create().orderBy("name asc").limit(500));
  }

  default boolean existsByParentId(Long parentId) {
    return selectCountByQuery(
            QueryWrapper.create().where(new QueryColumn("parent_id").eq(parentId)))
        > 0;
  }

  /** 同级重名校验排除自身；新建目录 id 传 null。 */
  default boolean existsByOwnerIdAndParentIdAndNameAndIdNot(
      Long ownerId, Long parentId, String name, Long id) {
    QueryWrapper filter =
        QueryWrapper.create()
            .where(new QueryColumn("owner_id").eq(ownerId))
            .and(new QueryColumn("parent_id").eq(parentId))
            .and(new QueryColumn("name").eq(name));
    if (id != null) {
      filter.and(new QueryColumn("id").ne(id));
    }
    return selectCountByQuery(filter) > 0;
  }

  default Optional<FileDirectory> lock(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }
}
