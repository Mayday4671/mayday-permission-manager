package com.mayday.operations.workflow;

import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.system.repository.*;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** 只转换旧模型为空的记录。保留原申请、决定、人员顺序与状态，把原顺序模型封装为不可变运行快照。 标记与任务在同一事务提交，重启不会重复导入，也不会发送补造的历史通知。 */
@Component
@Order(50)
@RequiredArgsConstructor
public class LegacyWorkflowImport implements CommandLineRunner {
  private final FlowDefinitionRepository definitions;
  private final FlowVersionRepository versions;
  private final FlowRequestRepository requests;
  private final FlowTaskRepository tasks;
  private final EntryRepository entries;
  private final UserRepository users;
  private final WorkflowJson json;

  @Override
  @Transactional
  public void run(String... args) {
    for (var d : definitions.findAll())
      if (d.getDraftSchema() == null) {
        var s = WorkflowDefinitions.legacy(d.getApproverIds());
        var v = new FlowVersion();
        v.setDefinitionId(d.getId());
        v.setVersionNumber(1);
        v.setSchemaJson(json.write(s));
        v.setPublisherName("旧版迁移");
        versions.saveAndFlush(v);
        d.setDraftSchema(v.getSchemaJson());
        d.setPublishedVersionId(v.getId());
        if (d.getCategoryId() == null)
          d.setCategoryId(
              entries.findByKindOrderBySortOrderAscIdAsc("approvalcategories").getFirst().getId());
      }
    for (var r : requests.findAll())
      if (r.getSchemaSnapshot() == null) {
        var ids = new ArrayList<>(r.getApproverIds());
        var s = WorkflowDefinitions.legacy(ids);
        r.setSchemaSnapshot(json.write(s));
        r.setFormData(json.write(Map.of("content", r.getContent())));
        r.setSubmittedFormData(r.getFormData());
        Map<String, List<Long>> resolved = new LinkedHashMap<>();
        for (var node : s.nodes())
          if (node.type().equals("APPROVAL")) resolved.put(node.id(), node.assigneeIds());
        r.setResolvedAssignees(json.write(resolved));
        definitions
            .findById(r.getDefinitionId())
            .ifPresent(d -> r.setDefinitionVersionId(d.getPublishedVersionId()));
        if (r.getStatus().equals("PENDING")) r.setCurrentNodeId("step" + r.getCurrentStep());
        else r.setCompletedAt(r.getUpdatedAt());
        r.setApproverIds(new ArrayList<>());
        for (int i = 0; i < ids.size(); i++) {
          if (r.getStatus().equals("PENDING") && i > r.getCurrentStep()) break;
          Long uid = ids.get(i);
          var task = new FlowTask();
          task.setRequestId(r.getId());
          task.setNodeId("step" + i);
          task.setNodeName("审批 " + (i + 1));
          task.setAssigneeId(uid);
          task.setAssigneeName(users.findById(uid).map(u -> u.getNickname()).orElse("已删除账号"));
          task.setStatus(
              i < r.getCurrentStep()
                  ? "APPROVED"
                  : switch (r.getStatus()) {
                    case "PENDING" -> "PENDING";
                    case "APPROVED" -> "APPROVED";
                    case "REJECTED" -> "REJECTED";
                    default -> "CANCELLED";
                  });
          tasks.save(task);
          if (!r.getApproverIds().contains(uid)) r.getApproverIds().add(uid);
        }
      }
  }
}
