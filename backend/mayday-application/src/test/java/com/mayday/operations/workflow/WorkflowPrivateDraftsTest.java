package com.mayday.operations.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.operations.model.FlowDecision;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.repository.FlowDecisionRepository;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;

/** 私人稿读取边界回归；真实字段/附件/标题搜索授权及事务回滚另由隔离 MySQL HTTP 验收。 */
class WorkflowPrivateDraftsTest {
  private final FlowDecisionRepository history = mock(FlowDecisionRepository.class);
  private final WorkflowJson json = new WorkflowJson();
  private final WorkflowPrivateDrafts drafts = new WorkflowPrivateDrafts(history, json);
  private final Spec schema =
      new Spec(
          List.of(
              new Field("memo", "说明", "TEXT", true, 24, null, null, 100, null),
              new Field("proof", "附件", "FILES", false, 24, null, null, null, null)),
          List.of(),
          null,
          "ALL",
          Set.of(),
          false,
          true,
          true);

  @Test
  void separateDraftNeverChangesSubmittedFieldsOrNotificationTitle() {
    var request = request("RETURNED");
    request.setPrivateDraft(
        json.write(
            Map.of("title", "未提交标题", "values", Map.of("memo", "未提交修改", "proof", List.of(20L)))));
    assertEquals("已提交标题", drafts.title(request, false));
    assertEquals("未提交标题", drafts.title(request, true));
    assertEquals("正式值", drafts.submittedValues(request, schema).get("memo"));
    assertEquals(List.of(10), drafts.submittedValues(request, schema).get("proof"));
    assertEquals("未提交修改", drafts.editableValues(request).get("memo"));
    assertEquals(List.of(20), drafts.editableValues(request).get("proof"));
    verify(history, never()).findAll(any(Specification.class), any(Sort.class));
  }

  @Test
  void oldReturnedAndTerminatedDraftReplaysOnlySubmittedApprovalChangesWithoutWritingOldColumns() {
    var request = request("RETURNED");
    var submit = decision(1, "SUBMIT");
    submit.setFormSnapshot(json.write(Map.of("memo", "提交值", "proof", List.of(10L))));
    var approval = decision(2, "APPROVE");
    approval.setChangesJson(
        json.write(
            Map.of(
                "memo",
                Map.of("before", "提交值", "after", "审批修正"),
                "managementAudit",
                Map.of("after", "不能混入表单"))));
    var closed = decision(3, "RETURN");
    var edit = decision(4, "EDIT");
    edit.setChangesJson(
        json.write(
            Map.of(
                "memo",
                Map.of("before", "审批修正", "after", "私人修改"),
                "proof",
                Map.of("before", List.of(10L), "after", List.of(20L)))));
    when(history.findAll(any(Specification.class), any(Sort.class)))
        .thenReturn(List.of(submit, approval, closed, edit));
    request.setTitle("私人标题覆盖");
    request.setFormData(json.write(Map.of("memo", "私人修改", "proof", List.of(20L))));
    String stored = request.getFormData();
    for (String state : List.of("RETURNED", "CANCELLED")) {
      request.setStatus(state);
      var committed = drafts.submittedValues(request, schema);
      assertEquals("审批修正", committed.get("memo"));
      assertEquals(List.of(10), committed.get("proof"));
      assertEquals(Set.of("memo", "proof"), committed.keySet());
      assertEquals("合成审批 · 申请 #90", drafts.title(request, false));
      assertEquals("私人标题覆盖", drafts.title(request, true));
      assertEquals("私人修改", drafts.editableValues(request).get("memo"));
      assertEquals(stored, request.getFormData(), "读取兼容逻辑不能改写原业务列");
    }
  }

  @Test
  void withdrawalAndResubmissionSelectTheLatestSubmittedRoundWithoutReplayingEdit() {
    var request = request("WITHDRAWN");
    request.setRunNumber(2);
    var first = decision(1, "SUBMIT");
    first.setFormSnapshot(json.write(Map.of("memo", "第一轮")));
    var second = decision(4, "RESUBMIT");
    second.setRunNumber(2);
    second.setFormSnapshot(json.write(Map.of("memo", "第二轮", "proof", List.of(11L))));
    var closed = decision(5, "WITHDRAW");
    closed.setRunNumber(2);
    var edit = decision(6, "EDIT");
    edit.setRunNumber(2);
    edit.setChangesJson(json.write(Map.of("memo", Map.of("after", "第二轮私稿"))));
    when(history.findAll(any(Specification.class), any(Sort.class)))
        .thenReturn(List.of(first, second, closed, edit));
    assertEquals("第二轮", drafts.submittedValues(request, schema).get("memo"));
    assertEquals(List.of(11), drafts.submittedValues(request, schema).get("proof"));
    request.setStatus("PENDING");
    assertTrue(drafts.legacyPrivateEdits(request).isEmpty(), "重新提交后由正式当前列读取");
  }

  private FlowRequest request(String state) {
    var request = new FlowRequest();
    request.setId(90L);
    request.setDefinitionName("合成审批");
    request.setTitle("已提交标题");
    request.setStatus(state);
    request.setRunNumber(1);
    request.setFormData(json.write(Map.of("memo", "正式值", "proof", List.of(10L))));
    return request;
  }

  private FlowDecision decision(long id, String action) {
    var decision = new FlowDecision();
    decision.setId(id);
    decision.setRequestId(90L);
    decision.setRunNumber(1);
    decision.setAction(action);
    return decision;
  }
}
