package com.mayday.operations.repository;

import com.mayday.operations.model.FlowDelegation;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

/** 有效期采用左闭右开区间；创建在账号行锁内检查重叠，防止并发生成委托链。 */
public interface FlowDelegationRepository
    extends JpaRepository<FlowDelegation, Long>, JpaSpecificationExecutor<FlowDelegation> {
  @Query(
      "select d from FlowDelegation d where d.revokedAt is null and d.startsAt < :end and d.endsAt > :start and (d.ownerId=:userId or d.targetId=:userId)")
  List<FlowDelegation> overlapping(Long userId, LocalDateTime start, LocalDateTime end);

  @Query(
      "select d from FlowDelegation d where d.ownerId=:owner and d.revokedAt is null and d.startsAt<=:now and d.endsAt>:now order by d.id")
  List<FlowDelegation> effective(Long owner, LocalDateTime now);
}
