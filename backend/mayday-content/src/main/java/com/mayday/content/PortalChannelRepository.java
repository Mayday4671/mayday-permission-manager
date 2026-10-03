package com.mayday.content;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** 门户栏目按显式排序读取；唯一访问名称由数据库约束处理并发新增冲突。 */
public interface PortalChannelRepository extends JpaRepository<PortalChannel, Long> {
  List<PortalChannel> findAllByOrderBySortOrderAscIdAsc();

  Optional<PortalChannel> findByCode(String code);
}
