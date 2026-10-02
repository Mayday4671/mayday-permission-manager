package com.mayday.system.repository;

import com.mayday.system.model.SystemEntry;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/** 基础资料必须同时限定 kind，不能凭 ID 跨资源读写。 */
public interface EntryRepository
    extends JpaRepository<SystemEntry, Long>, JpaSpecificationExecutor<SystemEntry> {
  /** 按已校验资料类型稳定排序；菜单可见性、停用状态和资源授权由服务层继续筛选。 */
  List<SystemEntry> findByKindOrderBySortOrderAscIdAsc(String kind);

  /** 删除父级前检查所有子记录，禁止把仍有后代的部门或菜单变成孤立节点。 */
  boolean existsByParentId(Long parentId);

  /** 删除账号前检查是否仍担任部门负责人，避免动态审批找不到负责人。 */
  boolean existsByLeaderId(Long leaderId);

  /** 按资料类型汇总数量；仅供已获得相应查看权限的汇总接口使用。 */
  long countByKind(String kind);
}
