package com.mayday.operations.workflow;

import com.mayday.operations.model.FlowTask;
import com.mayday.operations.model.FlowVersion;
import com.mayday.operations.repository.FlowDefinitionRepository;
import com.mayday.operations.repository.FlowRequestRepository;
import com.mayday.operations.repository.FlowTaskRepository;
import com.mayday.operations.repository.FlowVersionRepository;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.UserRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
  private final com.mayday.common.ModuleSwitches modules;

  @Override
  @Transactional
  public void run(String... args) {
    if (!modules.isEnabled("approvals")) return;
    for (var definition : definitions.findAll())
      if (definition.getDraftSchema() == null) {
        var schema = WorkflowDefinitions.legacy(definition.getApproverIds());
        var publishedVersion = new FlowVersion();
        publishedVersion.setDefinitionId(definition.getId());
        publishedVersion.setVersionNumber(1);
        publishedVersion.setSchemaJson(json.write(schema));
        publishedVersion.setPublisherName("旧版迁移");
        versions.saveAndFlush(publishedVersion);
        definition.setDraftSchema(publishedVersion.getSchemaJson());
        definition.setPublishedVersionId(publishedVersion.getId());
        if (definition.getCategoryId() == null)
          definition.setCategoryId(
              entries.findByKindOrderBySortOrderAscIdAsc("approvalcategories").getFirst().getId());
      }
    for (var request : requests.findAll())
      if (request.getSchemaSnapshot() == null) {
        var ids = new ArrayList<>(request.getApproverIds());
        var schema = WorkflowDefinitions.legacy(ids);
        request.setSchemaSnapshot(json.write(schema));
        request.setFormData(json.write(Map.of("content", request.getContent())));
        request.setSubmittedFormData(request.getFormData());
        Map<String, List<Long>> resolved = new LinkedHashMap<>();
        for (var node : schema.nodes())
          if (node.type().equals("APPROVAL")) resolved.put(node.id(), node.assigneeIds());
        request.setResolvedAssignees(json.write(resolved));
        definitions
            .findById(request.getDefinitionId())
            .ifPresent(
                definition -> request.setDefinitionVersionId(definition.getPublishedVersionId()));
        if (request.getStatus().equals("PENDING"))
          request.setCurrentNodeId("step" + request.getCurrentStep());
        else request.setCompletedAt(request.getUpdatedAt());
        request.setApproverIds(new ArrayList<>());
        for (int index = 0; index < ids.size(); index++) {
          if (request.getStatus().equals("PENDING") && index > request.getCurrentStep()) break;
          Long userId = ids.get(index);
          var task = new FlowTask();
          task.setRequestId(request.getId());
          task.setNodeId("step" + index);
          task.setNodeName("审批 " + (index + 1));
          task.setAssigneeId(userId);
          task.setAssigneeName(users.findById(userId).map(u -> u.getNickname()).orElse("已删除账号"));
          task.setStatus(
              index < request.getCurrentStep()
                  ? "APPROVED"
                  : switch (request.getStatus()) {
                    case "PENDING" -> "PENDING";
                    case "APPROVED" -> "APPROVED";
                    case "REJECTED" -> "REJECTED";
                    default -> "CANCELLED";
                  });
          tasks.save(task);
          if (!request.getApproverIds().contains(userId)) request.getApproverIds().add(userId);
        }
      }
  }
}
