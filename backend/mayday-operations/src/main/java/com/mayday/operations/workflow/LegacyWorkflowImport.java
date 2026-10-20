package com.mayday.operations.workflow;

import com.mayday.operations.mapper.FlowDefinitionMapper;
import com.mayday.operations.mapper.FlowRequestMapper;
import com.mayday.operations.mapper.FlowTaskMapper;
import com.mayday.operations.mapper.FlowVersionMapper;
import com.mayday.operations.model.FlowTask;
import com.mayday.operations.model.FlowVersion;
import com.mayday.system.mapper.EntryMapper;
import com.mayday.system.mapper.UserMapper;
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
  private final FlowDefinitionMapper definitions;
  private final FlowVersionMapper versions;
  private final FlowRequestMapper requests;
  private final FlowTaskMapper tasks;
  private final EntryMapper entries;
  private final UserMapper users;
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
        versions.save(publishedVersion);
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
          // 旧申请仅有 currentStep 的可靠实际到达证据；未来取消节点不得因迁移获得字段读取权。
          if ("APPROVED".equals(request.getStatus()) || index <= request.getCurrentStep())
            task.setActivatedAt(request.getUpdatedAt());
          tasks.save(task);
          if (!request.getApproverIds().contains(userId)) request.getApproverIds().add(userId);
        }
      }
  }
}
