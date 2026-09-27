package com.mayday.system.repository;

import com.mayday.system.model.SystemEntry;
import java.util.List;
import org.springframework.data.jpa.repository.*;

/** 基础资料必须同时限定 kind，不能凭 ID 跨资源读写。 */
public interface EntryRepository
    extends JpaRepository<SystemEntry, Long>, JpaSpecificationExecutor<SystemEntry> {
  List<SystemEntry> findByKindOrderBySortOrderAscIdAsc(String kind);

  boolean existsByParentId(Long parentId);

  boolean existsByLeaderId(Long leaderId);

  long countByKind(String kind);
}
