package com.mayday.operations.monitor;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** 历史按时间范围和节点查询；有限条数的服务端采样聚合避免向页面一次发送全部历史。 */
public interface MonitorSampleRepository extends JpaRepository<MonitorSample, Long> {
  List<MonitorSample> findByNodeIdAndCreatedAtGreaterThanEqualOrderByIdDesc(
      String nodeId, LocalDateTime since, Pageable pageable);

  void deleteByCreatedAtBefore(LocalDateTime before);
}
