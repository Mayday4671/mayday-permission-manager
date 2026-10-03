package com.mayday.content;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** 分类归属与栏目保存同处事务；拒绝在多个菜单下重复配置同一分类。 */
public interface PortalCategoryRepository extends JpaRepository<PortalCategory, Long> {
  List<PortalCategory> findByChannelIdOrderBySortOrderAscCategoryIdAsc(Long channelId);

  boolean existsByChannelId(Long channelId);
}
