package com.mayday.service;

import com.mayday.common.BusinessException;
import com.mayday.content.ContentRevisionRepository;
import com.mayday.content.NoticeRepository;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.workflow.WorkflowBusiness;
import com.mayday.security.AccessPolicy;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/** 内容审核只授权不可变修订。审批引擎不直接操作内容表，内容也不直接修改审批任务。 */
@Service
@RequiredArgsConstructor
public class ContentApprovalBinding implements WorkflowBusiness {
  private final ContentService content;
  private final NoticeRepository notices;
  private final ContentRevisionRepository revisions;
  private final AccessPolicy access;

  @Override
  public String type() {
    return "CONTENT";
  }

  @Override
  public Map<String, Object> submitted(FlowRequest request, Long businessVersion) {
    access.require("notices:update");
    if (request.getBusinessId() == null || request.getBusinessRevisionId() == null)
      throw new BusinessException("请选择内容及送审修订");
    var n = content.managed(request.getBusinessId(), true);
    UserService.version(n, businessVersion);
    if (n.getDeletedAt() != null
        || !Objects.equals(n.getDraftRevisionId(), request.getBusinessRevisionId()))
      throw new BusinessException("内容已删除或修订已变化，请重新选择");
    var r = content.revision(request.getBusinessRevisionId(), n.getId());
    if (Set.of("PENDING", "APPROVED").contains(r.getApprovalStatus()))
      throw new BusinessException("此修订已经在审核中或已通过，请勿重复提交");
    if (n.getScheduledPublishAt() != null) throw new BusinessException("请先取消上线排期再送审");
    n.setRequiresApproval(true);
    n.setDraftStatus("PENDING");
    r.setApprovalStatus("PENDING");
    r.setApprovalRequestId(request.getId());
    return content.revisionView(r);
  }

  @Override
  public void completed(FlowRequest request) {
    var n =
        notices
            .lockById(request.getBusinessId())
            .orElseThrow(() -> new BusinessException("审核关联内容不存在"));
    var r =
        revisions
            .findById(request.getBusinessRevisionId())
            .orElseThrow(() -> new BusinessException("审核关联修订不存在"));
    if (!Objects.equals(r.getApprovalRequestId(), request.getId()))
      throw new BusinessException("该修订已经重新送审，不能处理旧申请");
    r.setApprovalStatus(request.getStatus());
    // 后续新稿和回收站状态不受旧修订审核结果影响；保存新稿必须重新申请。
    if (n.getDeletedAt() == null && Objects.equals(n.getDraftRevisionId(), r.getId()))
      n.setDraftStatus(request.getStatus().equals("APPROVED") ? "APPROVED" : "DRAFT");
  }

  @Override
  public Map<String, Object> detail(FlowRequest request) {
    var n =
        notices
            .findById(request.getBusinessId())
            .orElseThrow(() -> new BusinessException("审核关联内容不存在"));
    var r = content.revision(request.getBusinessRevisionId(), n.getId());
    var result = content.revisionView(r);
    result.put("noticeId", n.getId());
    result.put("currentRevision", Objects.equals(n.getDraftRevisionId(), r.getId()));
    result.put("deleted", n.getDeletedAt() != null);
    return result;
  }
}
