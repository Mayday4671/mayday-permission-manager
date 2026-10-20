package com.mayday.system.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.system.model.SystemEntry;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 基础资料必须同时限定 kind，不能凭 ID 跨资源读写。 */
@Mapper
public interface EntryMapper extends EntityMapper<SystemEntry> {
  /** 按已校验资料类型稳定排序；菜单可见性、停用状态和资源授权由服务层继续筛选。 */
  default List<SystemEntry> findByKindOrderBySortOrderAscIdAsc(String kind) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("kind").eq(kind))
            .orderBy("sort_order asc, id asc"));
  }

  /** 删除父级前检查所有子记录，禁止把仍有后代的部门或菜单变成孤立节点。 */
  default boolean existsByParentId(Long parentId) {
    return selectCountByQuery(
            QueryWrapper.create().where(new QueryColumn("parent_id").eq(parentId)))
        > 0;
  }

  /** 删除账号前检查是否仍担任部门负责人，避免动态审批找不到负责人。 */
  default boolean existsByLeaderId(Long leaderId) {
    return selectCountByQuery(
            QueryWrapper.create().where(new QueryColumn("leader_id").eq(leaderId)))
        > 0;
  }

  /** 按资料类型汇总数量；仅供已获得相应查看权限的汇总接口使用。 */
  default long countByKind(String kind) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("kind").eq(kind)));
  }
}
