package com.mayday.operations.repository;

import com.mayday.operations.model.FlowRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** 审批实例保留申请内容和审批人快照；使用版本号防止两个决策覆盖。 数据访问层。 */
public interface FlowRequestRepository
    extends JpaRepository<FlowRequest, Long>, JpaSpecificationExecutor<FlowRequest> {
  @Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @Query("select r from FlowRequest r where r.id=:id")
  java.util.Optional<FlowRequest> lockById(Long id);

  boolean existsByDefinitionId(Long id);

  boolean existsByAttachmentIdsContains(Long fileId);

  boolean existsByBusinessTypeAndBusinessId(String businessType, Long businessId);

  /** 子申请保留历史；父申请取消时仅传播到尚在运行的子申请。 */
  java.util.List<FlowRequest> findByParentRequestIdOrderByIdAsc(Long parentRequestId);
}
