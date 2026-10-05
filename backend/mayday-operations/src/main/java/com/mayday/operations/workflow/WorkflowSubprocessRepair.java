package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.repository.FlowVersionRepository;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.UserRepository;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/** 尚未生成子申请的人员修复。覆盖只属于父申请的一次固定调用，不修改发布版本、表单或执行位置。 已生成子申请必须在该子申请使用人员交接；这里不能越过子申请锁偷偷改写其待办。 */
@Service
@RequiredArgsConstructor
public class WorkflowSubprocessRepair {
  /** 保留键使用冒号分隔，合法节点编号不允许冒号，因此不会覆盖原有节点交接记录。 */
  private static final String PREFIX = "subprocess:";

  public static final String AUDIT_KEY = "__subprocessRepair";
  private final WorkflowJson json;
  private final WorkflowDefinitions definitions;
  private final FlowVersionRepository versions;
  private final UserRepository users;
  private final EntryRepository entries;
  private final AccessPolicy access;

  /** 版本和调用游标均来自打开弹窗时的服务端快照；客户端不能提交新子流程版本。 */
  public record Repair(
      @NotNull Long version,
      @NotBlank @Size(max = 40) String tokenId,
      @NotBlank @Size(max = 40) String childNodeId,
      @NotNull @Size(min = 1, max = 100) List<@NotNull Long> targetUserIds,
      @NotBlank @Size(max = 300) String reason) {}

  /** 页面入口只判断权限和状态；目录查询再核验人员范围，不在详情中泄露子流程人员目录。 */
  public boolean available(FlowRequest request) {
    return access.has("requests:manage")
        && access.has("requests:reassign")
        && access.has("users:view")
        && "PENDING".equals(request.getStatus())
        && request.getExecutionState() != null
        && json.execution(request.getExecutionState()).getTokens().stream()
            .anyMatch(token -> eligible(request, token));
  }

  private boolean eligible(FlowRequest request, WorkflowExecutionState.Token token) {
    return "FAILED".equals(token.getStatus())
        && token.getChildRequestId() == null
        && "SUBPROCESS"
            .equals(json.spec(request.getSchemaSnapshot()).node(token.getNodeId()).type());
  }

  private void require(FlowRequest request) {
    access.require("requests:manage");
    access.require("requests:reassign");
    access.require("users:view");
    if (!available(request)) throw new BusinessException("没有可修复的待启动子流程调用");
    var applicant = users.findById(request.getApplicantId()).orElseThrow();
    // 即使角色已无成员或部门负责人为空，也不能借空来源绕过管理人员的数据范围。
    access.checkData("users", applicant.getId(), applicant.getDepartmentId());
  }

  /** 停用定义仍可检查固定版本的人员来源；真正恢复启动时继续核验定义启用状态。 */
  private Spec bound(Node caller) {
    var version =
        versions
            .findById(caller.subprocess().versionId())
            .orElseThrow(() -> new BusinessException("绑定的子流程版本不存在"));
    return json.spec(version.getSchemaJson());
  }

  /** 原来源保留停用账号用于范围检查和审计，绝不因账号失效而换用最新发布人员。 */
  private List<Long> source(FlowRequest request, Node node, Map<String, List<Long>> overrides) {
    if (overrides.containsKey(node.id())) return overrides.get(node.id());
    if ("USERS".equals(node.source())) return node.assigneeIds();
    if ("DEPARTMENT_LEADER".equals(node.source())) {
      var applicant = users.findById(request.getApplicantId()).orElseThrow();
      return java.util.Optional.ofNullable(applicant.getDepartmentId())
          .flatMap(entries::findById)
          .map(
              department ->
                  department.getLeaderId() == null
                      ? List.<Long>of()
                      : List.of(department.getLeaderId()))
          .orElse(List.of());
    }
    return users
        .findAll(
            (root, query, criteria) -> {
              query.distinct(true);
              return root.join("roles").get("id").in(node.assigneeIds());
            })
        .stream()
        .map(SysUser::getId)
        .sorted()
        .toList();
  }

  private List<Map<String, Object>> scopedPeople(List<Long> ids, boolean originalSource) {
    return ids.stream()
        .map(
            id -> {
              Map<String, Object> option = new LinkedHashMap<>();
              var person = users.findById(id).orElse(null);
              if (person == null) {
                if (!originalSource) throw new BusinessException("新处理人员不存在");
                // JSON 中的固定来源只有编号，删除后无法证明所属部门；只有全用户范围可以处理未知来源。
                if (!"ALL".equals(access.scope("users")))
                  throw new AccessDeniedException("已删除来源人员须由全用户范围管理员修复");
                option.put("value", id);
                option.put("label", "已删除账号 #" + id);
                return option;
              }
              access.checkData("users", person.getId(), person.getDepartmentId());
              option.put("value", person.getId());
              option.put("label", person.getNickname() + (person.isEnabled() ? "" : "（已停用）"));
              return option;
            })
        .toList();
  }

  /** 只返回当前失败且尚未生成子申请的调用及其审批节点；全部原来源先通过服务端范围检查。 */
  public List<Map<String, Object>> options(FlowRequest request) {
    require(request);
    var parent = json.spec(request.getSchemaSnapshot());
    return json.execution(request.getExecutionState()).getTokens().stream()
        .filter(token -> eligible(request, token))
        .map(
            token -> {
              var caller = parent.node(token.getNodeId());
              var child = bound(caller);
              var overrides = overrides(request, caller.id());
              Map<String, Object> option = new LinkedHashMap<>();
              option.put("tokenId", token.getId());
              option.put("callerNodeId", caller.id());
              option.put("callerName", caller.name());
              option.put("versionId", caller.subprocess().versionId());
              option.put(
                  "nodes",
                  child.nodes().stream()
                      .filter(node -> java.util.Set.of("APPROVAL", "COPY").contains(node.type()))
                      .map(
                          node ->
                              Map.of(
                                  "id",
                                  node.id(),
                                  "name",
                                  node.name(),
                                  "source",
                                  node.source(),
                                  "type",
                                  node.type(),
                                  "sourceIds",
                                  node.assigneeIds(),
                                  "people",
                                  scopedPeople(source(request, node, overrides), true)))
                      .toList());
              return option;
            })
        .toList();
  }

  /** 调用方已取得根申请和当前申请锁。只替换指定审批节点的完整人员次序，允许多个失效节点逐项修复。 当前版本、目标权利、自审和共同路径重复规则失败时不写入任何覆盖；恢复执行仍再次完整解析。 */
  public Map<String, Object> apply(FlowRequest request, Repair input) {
    require(request);
    var token = json.execution(request.getExecutionState()).require(input.tokenId());
    if (!eligible(request, token)) throw new BusinessException("该调用已不再等待启动修复");
    var caller = json.spec(request.getSchemaSnapshot()).node(token.getNodeId());
    var child = bound(caller);
    var node = child.node(input.childNodeId());
    if (!java.util.Set.of("APPROVAL", "COPY").contains(node.type()))
      throw new BusinessException("只能修复子流程审批或抄送节点人员");
    boolean approval = "APPROVAL".equals(node.type());
    var overrides = overrides(request, caller.id());
    var before = source(request, node, overrides);
    var original = scopedPeople(before, true);
    var targets = input.targetUserIds();
    if (targets.stream().distinct().count() != targets.size())
      throw new BusinessException("审批人不能重复选择");
    var after = scopedPeople(targets, false);
    for (Long id : targets) {
      var target = users.findById(id).orElseThrow();
      if (!target.isEnabled()
          || !access.hasFor(target, "requests:view")
          || (approval && !access.hasFor(target, "requests:approve")))
        throw new BusinessException(approval ? "新审批人须启用并拥有申请查看和审批权限" : "新抄送人须启用并拥有申请查看权限");
      if (approval
          && !Boolean.TRUE.equals(child.allowSelfApproval())
          && Objects.equals(id, request.getApplicantId()))
        throw new BusinessException("子流程不允许申请人自我审批");
    }
    if (approval && !Boolean.TRUE.equals(child.allowRepeatApproval()))
      for (Node other : child.nodes())
        if ("APPROVAL".equals(other.type())
            && !other.id().equals(node.id())
            && definitions.shareApprovalPath(child, node.id(), other.id())
            && source(request, other, overrides).stream().anyMatch(targets::contains))
          throw new BusinessException("子流程共同路径不能指定重复审批人");
    if (before.equals(targets)) throw new BusinessException("审批人员没有变化");
    var stored = new LinkedHashMap<>(json.assignees(request.getAssignmentOverrides()));
    stored.put(PREFIX + caller.id() + ":" + node.id(), List.copyOf(targets));
    request.setAssignmentOverrides(json.write(stored));
    Map<String, Object> audit = new LinkedHashMap<>();
    audit.put("callerNodeId", caller.id());
    audit.put("childNodeId", node.id());
    audit.put("childNodeName", node.name());
    audit.put("childNodeType", node.type());
    audit.put("versionId", caller.subprocess().versionId());
    audit.put("source", node.source());
    audit.put("sourceIds", node.assigneeIds());
    audit.put("before", original);
    audit.put("after", after);
    return audit;
  }

  /** 启动只抽取属于该固定调用的覆盖；不把父流程其他节点人员带入子申请。 */
  public Map<String, List<Long>> overrides(FlowRequest request, String callerId) {
    String prefix = PREFIX + callerId + ":";
    Map<String, List<Long>> result = new LinkedHashMap<>();
    json.assignees(request.getAssignmentOverrides())
        .forEach(
            (key, people) -> {
              if (key.startsWith(prefix)) result.put(key.substring(prefix.length()), people);
            });
    return result;
  }

  /** 审计读取也逐一核对当前管理员的用户范围；后续缩小范围后不能继续看到旧修复人员。 */
  public Object auditView(Object value) {
    if (!(value instanceof Map<?, ?> audit)) return null;
    for (String side : List.of("before", "after")) {
      if (!(audit.get(side) instanceof List<?> people)) return null;
      for (Object item : people) {
        if (!(item instanceof Map<?, ?> person) || !(person.get("value") instanceof Number id))
          return null;
        var user = users.findById(id.longValue()).orElse(null);
        if (user == null
            ? !"ALL".equals(access.scope("users"))
            : !access.contains("users", user.getId(), user.getDepartmentId())) return null;
      }
    }
    return audit;
  }
}
