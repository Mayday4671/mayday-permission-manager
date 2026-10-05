package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.model.FlowDecision;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.repository.FlowDecisionRepository;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;

/**
 * 已提交内容与退回后的私人修改分别读取。调用方先核验参与权和字段权限，再明确选择申请人 私人视图或已提交视图；通知永远使用已提交标题。兼容旧 EDIT 的处理只读历史，不在升级时改写业务列。
 */
@Component
@RequiredArgsConstructor
public class WorkflowPrivateDrafts {
  private final FlowDecisionRepository history;
  private final WorkflowJson json;

  /** 只识别旧版退回/撤回后 EDIT 覆盖。已有独立私人稿表示已提交列正确，不再重建；终止后的 CANCELLED 仍需兼容，因为管理员终止并不会使此前私人修改成为正式审批数据。 */
  List<FlowDecision> legacyPrivateEdits(FlowRequest request) {
    if (request.getPrivateDraft() != null
        || !Set.of("RETURNED", "WITHDRAWN", "CANCELLED").contains(request.getStatus()))
      return List.of();
    var records =
        history.findAll(
            (root, query, cb) -> cb.equal(root.get("requestId"), request.getId()), Sort.by("id"));
    long closed =
        records.stream()
            .filter(
                item ->
                    item.getRunNumber() == request.getRunNumber()
                        && Set.of("RETURN", "WITHDRAW").contains(item.getAction()))
            .mapToLong(FlowDecision::getId)
            .max()
            .orElse(Long.MAX_VALUE);
    return records.stream()
            .anyMatch(
                item ->
                    item.getRunNumber() == request.getRunNumber()
                        && "EDIT".equals(item.getAction())
                        && item.getId() > closed)
        ? records
        : List.of();
  }

  /**
   * 旧库保存曾覆盖 form_data，故先从本轮最后提交快照恢复，再重放正式审批的字段变更。 私人 EDIT 无论误归哪轮均不参与重放；无可信快照时只采用原始提交，不采用可能泄露的当前列。
   */
  Map<String, Object> submittedValues(FlowRequest request, Spec spec) {
    var records = legacyPrivateEdits(request);
    if (records.isEmpty()) return storedValues(request);
    var submitted =
        records.stream()
            .filter(
                item ->
                    item.getRunNumber() == request.getRunNumber()
                        && Set.of("SUBMIT", "RESUBMIT").contains(item.getAction())
                        && item.getFormSnapshot() != null)
            .reduce((before, after) -> after)
            .orElse(null);
    var result =
        new LinkedHashMap<String, Object>(
            submitted == null
                ? request.getSubmittedFormData() == null
                    ? Map.of()
                    : json.form(request.getSubmittedFormData())
                : json.form(submitted.getFormSnapshot()));
    Set<String> fields = new HashSet<>(spec.fields().stream().map(Field::id).toList());
    for (var decision : records) {
      if (decision.getRunNumber() != request.getRunNumber()
          || "EDIT".equals(decision.getAction())
          || (submitted != null && decision.getId() <= submitted.getId())
          || decision.getChangesJson() == null) continue;
      json.form(decision.getChangesJson())
          .forEach(
              (key, change) -> {
                if (fields.contains(key)
                    && change instanceof Map<?, ?> values
                    && values.containsKey("after")) result.put(key, values.get("after"));
              });
    }
    return result;
  }

  /** 只供已核验原申请人的详情、继续编辑及附件下载；执行推进仍使用已提交列。 */
  Map<String, Object> editableValues(FlowRequest request) {
    if (request.getPrivateDraft() == null) return storedValues(request);
    var draft = json.form(request.getPrivateDraft());
    if (!(draft.get("values") instanceof Map<?, ?>)) throw new BusinessException("私人稿损坏，请联系管理员恢复");
    return json.form(json.write(draft.get("values")));
  }

  /** 新私人稿保留旧标题；旧列已被覆盖但没有历史标题快照时用安全编号代替。申请人可继续看到 自己保存的标题，审批人、管理者和站内通知都不能借标题读取尚未提交的内容。 */
  String title(FlowRequest request, boolean applicant) {
    if (applicant && request.getPrivateDraft() != null)
      return (String) json.form(request.getPrivateDraft()).get("title");
    return !applicant && !legacyPrivateEdits(request).isEmpty()
        ? legacyTitle(request)
        : request.getTitle();
  }

  /** 旧标题没有可信证据时不猜测；编号稳定且不包含私人填写。 */
  String legacyTitle(FlowRequest request) {
    return Objects.requireNonNullElse(request.getDefinitionName(), "审批")
        + " · 申请 #"
        + request.getId();
  }

  /** 未迁移的旧申请正文仍使用固定 content 字段，与引擎旧实例契约一致。 */
  private Map<String, Object> storedValues(FlowRequest request) {
    return request.getFormData() == null
        ? Map.of("content", request.getContent())
        : json.form(request.getFormData());
  }
}
