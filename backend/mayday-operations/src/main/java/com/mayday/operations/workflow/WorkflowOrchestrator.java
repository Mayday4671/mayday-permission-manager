package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.model.FlowTask;
import com.mayday.operations.repository.FlowRequestRepository;
import com.mayday.operations.repository.FlowTaskRepository;
import com.mayday.operations.workflow.WorkflowExecutionState.Token;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * 有界 DAG 的持久运行端。所有调用处均持有根申请行锁；同一子树的办理、恢复与取消按同一锁顺序串行。 每个游标保存独立节点、办理批次和已过路线，全部并行子游标到齐才释放父游标。
 * 子流程调用固定发布版本，申请与任务同事务保存；失败停在原节点等待显式恢复，不跳过审批。
 */
@Service
@RequiredArgsConstructor
public class WorkflowOrchestrator {
  private final WorkflowSubprocessRepair subprocessRepair;
  private final FlowRequestRepository requests;
  private final FlowTaskRepository tasks;
  private final WorkflowDefinitions definitions;
  private final WorkflowJson json;
  private final UserRepository users;
  private final AccessPolicy access;
  private final WorkflowEvents events;

  /** 第一次进入建立根游标；重启或后续推进只读取已保存状态，不重建已经激活的支路。 */
  public void enter(FlowRequest request, String next, WorkflowEngine host) {
    WorkflowExecutionState state = json.execution(request.getExecutionState());
    if (state == null) {
      state = new WorkflowExecutionState();
      state.add(next, null, List.of());
      if (request.getRootRequestId() == null) request.setRootRequestId(request.getId());
    }
    pump(request, state, host);
  }

  /** 待办身份绑定游标和访问批次，申请最后激活的另一条支路不会使当前合法待办失效。 */
  public boolean current(FlowRequest request, FlowTask task) {
    var state = json.execution(request.getExecutionState());
    if (state == null || task.getExecutionTokenId() == null) return false;
    Token token = state.require(task.getExecutionTokenId());
    return "APPROVAL".equals(token.getStatus())
        && token.getNodeId().equals(task.getNodeId())
        && token.getNodeVisit() == task.getNodeVisit();
  }

  /** 同一节点的会签/顺签全部完成后只移动所属游标，其他支路的任务保持有效。 */
  public void approved(FlowRequest request, FlowTask task, String next, WorkflowEngine host) {
    var state = json.execution(request.getExecutionState());
    Token token = state.require(task.getExecutionTokenId());
    token.setNodeId(next);
    token.setStatus("ACTIVE");
    pump(request, state, host);
  }

  /** 本支路内部退回只重开本游标；退回到并行前节点则取消整个当前并行组及其子流程后重开。 不接受其他支路的节点或汇合前已废弃的节点，避免跨路线跳转和复用旧通过凭证。 */
  public void returned(FlowRequest request, FlowTask task, String target, WorkflowEngine host) {
    if (target == null) {
      host.finish(request, "RETURNED");
      return;
    }
    var state = json.execution(request.getExecutionState());
    Token token = state.require(task.getExecutionTokenId());
    if (!returnTargets(request, task).contains(target))
      throw new BusinessException("退回目标不在当前支路已办理路径");
    Token restart = token;
    while (restart.getParentTokenId() != null) {
      Token parent = state.require(restart.getParentTokenId());
      if (!parent.getTrail().contains(target)) break;
      restart = parent;
    }
    Set<String> cancelled = state.descendants(restart.getId());
    cancelTasksAndChildren(request, cancelled, host);
    state.getTokens().stream()
        .filter(item -> cancelled.contains(item.getId()))
        .forEach(item -> item.setStatus("CANCELLED"));
    List<String> trail = restart.getTrail();
    Token reopened =
        state.add(target, restart.getParentTokenId(), trail.subList(0, trail.indexOf(target)));
    // 同一并行父游标等待的是当前有效子游标；废弃游标保留历史但不计入汇合数量。
    reopened.setJoinNodeId(restart.getJoinNodeId());
    pump(request, state, host);
  }

  /** 详情只提供本人当前游标已过审批节点；汇合后不会提供任意已结束支路作为跳转目标。 */
  public List<String> returnTargets(FlowRequest request, FlowTask task) {
    if (task == null || task.getExecutionTokenId() == null) return List.of();
    var token = json.execution(request.getExecutionState()).require(task.getExecutionTokenId());
    List<String> trail = token.getTrail();
    return trail.stream().filter(id -> !id.equals(task.getNodeId())).distinct().toList();
  }

  /** 当前节点集合用于运行图，不返回隐藏字段值、未来人员或子流程表单快照。 */
  public Set<String> currentNodes(FlowRequest request) {
    var state = json.execution(request.getExecutionState());
    if (state == null) return Set.of();
    Set<String> ids = new LinkedHashSet<>();
    state.getTokens().stream()
        .filter(token -> Set.of("APPROVAL", "WAIT_CHILD", "FAILED").contains(token.getStatus()))
        .forEach(token -> ids.add(token.getNodeId()));
    return ids;
  }

  /** 列表显示全部活动支路的名称，不能把第一个支路名称当作整项申请的唯一当前节点。 */
  public String currentNames(FlowRequest request) {
    Spec spec =
        request.getSchemaSnapshot() == null
            ? WorkflowDefinitions.legacy(request.getApproverIds())
            : json.spec(request.getSchemaSnapshot());
    return String.join(
        "、", currentNodes(request).stream().map(id -> spec.node(id).name()).toList());
  }

  /** 恢复按钮只针对持久失败状态；已完成或正在办理的节点不能借恢复入口重复执行。 */
  public boolean failed(FlowRequest request) {
    var state = json.execution(request.getExecutionState());
    return "PENDING".equals(request.getStatus())
        && state != null
        && state.getTokens().stream().anyMatch(token -> "FAILED".equals(token.getStatus()));
  }

  /** 管理员明确恢复原节点，先修复人员/权限/停用依赖；固定版本与字段映射不会变成最新草稿。 */
  public void recover(FlowRequest request, String reason, WorkflowEngine host) {
    if (!failed(request)) throw new BusinessException("申请没有可恢复的失败节点");
    var state = json.execution(request.getExecutionState());
    state.getTokens().stream()
        .filter(token -> "FAILED".equals(token.getStatus()))
        .forEach(
            token -> {
              token.setStatus("ACTIVE");
              token.setError(null);
            });
    host.record(request, "RECOVER", null, reason, null);
    pump(request, state, host);
    host.refreshParticipants(request);
  }

  /** 管理员可查看恢复原因；普通参与者只得到节点状态。子申请入口仍需要独立参与权。 */
  public List<Map<String, Object>> view(FlowRequest request) {
    var state = json.execution(request.getExecutionState());
    if (state == null) return List.of();
    return state.getTokens().stream()
        .filter(token -> !"CANCELLED".equals(token.getStatus()))
        .map(
            token -> {
              Map<String, Object> row = new LinkedHashMap<>();
              row.put("tokenId", token.getId());
              row.put("nodeId", token.getNodeId());
              row.put("status", token.getStatus());
              row.put("parentTokenId", token.getParentTokenId());
              row.put("childRequestId", token.getChildRequestId());
              if (access.has("requests:manage")) row.put("error", token.getError());
              if (token.getChildRequestId() != null)
                requests
                    .findById(token.getChildRequestId())
                    .ifPresent(
                        child -> {
                          row.put("childStatus", child.getStatus());
                          row.put("childVersionId", child.getDefinitionVersionId());
                          row.put(
                              "canViewChild",
                              access.has("requests:manage")
                                  || Objects.equals(
                                      child.getApplicantId(), access.current().getId())
                                  || child.getApproverIds().contains(access.current().getId()));
                        });
              return row;
            })
        .toList();
  }

  /** 固定子申请的历史关系独立于活动游标，父继续推进后仍可检查实际绑定版本和处理结果。 */
  public List<Map<String, Object>> children(FlowRequest request) {
    return requests.findByParentRequestIdOrderByIdAsc(request.getId()).stream()
        .map(
            child -> {
              Map<String, Object> row = new LinkedHashMap<>();
              row.put("id", child.getId());
              row.put("name", child.getDefinitionName());
              row.put("status", child.getStatus());
              row.put("versionId", child.getDefinitionVersionId());
              row.put("createdAt", child.getCreatedAt());
              row.put(
                  "canView",
                  access.has("requests:manage")
                      || Objects.equals(child.getApplicantId(), access.current().getId())
                      || child.getApproverIds().contains(access.current().getId()));
              return row;
            })
        .toList();
  }

  /** 父退回/撤回/终止取消整个运行子树；子自然完成才回调父游标，完成历史不被删除。 */
  public void ended(FlowRequest request, String status, boolean propagate, WorkflowEngine host) {
    var state = json.execution(request.getExecutionState());
    if (state != null && !"APPROVED".equals(status)) {
      state.getTokens().stream()
          .filter(token -> !"DONE".equals(token.getStatus()))
          .forEach(token -> token.setStatus("CANCELLED"));
      request.setExecutionState(json.write(state));
    }
    for (var child : requests.findByParentRequestIdOrderByIdAsc(request.getId()))
      // 已退回或已结束的子申请只保留结果历史，不因父结束再改写为“取消”。子申请不能独立重提。
      if ("PENDING".equals(child.getStatus()))
        host.finish(requests.lockById(child.getId()).orElseThrow(), "CANCELLED", false);
    if (!propagate || request.getParentRequestId() == null) return;
    var parent = requests.lockById(request.getParentRequestId()).orElseThrow();
    if (!"PENDING".equals(parent.getStatus())) return;
    var parentState = json.execution(parent.getExecutionState());
    Token caller = parentState.require(request.getParentTokenId());
    if (!"WAIT_CHILD".equals(caller.getStatus())
        || !Objects.equals(caller.getChildRequestId(), request.getId())) return;
    if (!"APPROVED".equals(status)) {
      host.record(
          parent,
          "SUBPROCESS_RESULT",
          host.schema(parent).node(caller.getNodeId()),
          "子流程结果：" + status,
          null);
      host.finish(
          parent,
          "RETURNED".equals(status)
              ? "RETURNED"
              : "REJECTED".equals(status) ? "REJECTED" : "CANCELLED");
      return;
    }
    caller.setStatus("ACTIVE");
    pump(parent, parentState, host);
    host.refreshParticipants(parent);
  }

  private void pump(FlowRequest request, WorkflowExecutionState state, WorkflowEngine host) {
    boolean progressed;
    int hops = 0;
    do {
      progressed = false;
      for (Token token : new ArrayList<>(state.getTokens())) {
        if (!"ACTIVE".equals(token.getStatus())) continue;
        if (++hops > 200) throw new BusinessException("流程推进超过安全上限");
        progressed = true;
        Node node = host.schema(request).node(token.getNodeId());
        try {
          switch (node.type()) {
            case "END" -> token.setStatus("DONE");
            case "CONDITION" -> token.setNodeId(WorkflowSchema.next(node, host.values(request)));
            case "PARALLEL" -> {
              token.setStatus("WAIT_JOIN");
              token.setJoinNodeId(node.next());
              for (String branch : node.branches())
                state.add(branch, token.getId(), token.getTrail());
            }
            case "JOIN" -> {
              if (token.getParentTokenId() == null) throw new BusinessException("汇合节点失去并行父游标");
              Token parent = state.require(token.getParentTokenId());
              if (!"WAIT_JOIN".equals(parent.getStatus())
                  || !node.id().equals(parent.getJoinNodeId()))
                throw new BusinessException("支路进入了其他并行组的汇合节点");
              token.setStatus("DONE");
              var siblings =
                  state.getTokens().stream()
                      .filter(
                          item ->
                              Objects.equals(item.getParentTokenId(), parent.getId())
                                  && !"CANCELLED".equals(item.getStatus()))
                      .toList();
              if (siblings.stream().allMatch(item -> "DONE".equals(item.getStatus()))) {
                parent.setStatus("ACTIVE");
                parent.setNodeId(node.next());
              }
            }
            case "SUBPROCESS" -> subprocess(request, state, token, node, host);
            case "APPROVAL", "COPY" -> openTasks(request, token, node, host);
            default -> throw new BusinessException("不支持的流程执行节点");
          }
        } catch (BusinessException | AccessDeniedException error) {
          token.setStatus("FAILED");
          token.setError(error.getMessage());
          events.enqueue(
              request,
              request.getApplicantId(),
              "execution-failed:" + token.getId() + ":" + request.getNodeVisit(),
              "审批流程等待管理员恢复");
        }
        request.setExecutionState(json.write(state));
      }
    } while (progressed
        && state.getTokens().stream().anyMatch(token -> "ACTIVE".equals(token.getStatus())));
    request.setExecutionState(json.write(state));
    request.setUpdatedAt(LocalDateTime.now());
    var current =
        tasks.findByRequestIdOrderByIdAsc(request.getId()).stream()
            .filter(task -> "PENDING".equals(task.getStatus()))
            .findFirst()
            .orElse(null);
    request.setCurrentNodeId(
        current == null
            ? currentNodes(request).stream().findFirst().orElse(null)
            : current.getNodeId());
    request.setCurrentApproverId(current == null ? null : current.getAssigneeId());
    if (state.getTokens().stream()
        .filter(token -> token.getParentTokenId() == null && !"CANCELLED".equals(token.getStatus()))
        .allMatch(token -> "DONE".equals(token.getStatus()))) host.finish(request, "APPROVED");
  }

  private void openTasks(FlowRequest request, Token token, Node node, WorkflowEngine host) {
    List<Long> ids = json.assignees(request.getResolvedAssignees()).get(node.id());
    if (ids == null || ids.isEmpty()) throw new BusinessException("节点缺少审批人快照");
    var accounts =
        ids.stream()
            .map(
                id ->
                    users
                        .findById(id)
                        .filter(
                            user ->
                                access.hasFor(user, "requests:view")
                                    && ("COPY".equals(node.type())
                                        || access.hasFor(user, "requests:approve")))
                        .orElseThrow(() -> new BusinessException("节点人员已停用或权限失效，请交接后恢复")))
            .toList();
    request.setNodeVisit(request.getNodeVisit() + 1);
    token.setNodeVisit(request.getNodeVisit());
    int index = 0;
    for (var user : accounts) {
      var task = new FlowTask();
      task.setRequestId(request.getId());
      task.setExecutionTokenId(token.getId());
      task.setNodeId(node.id());
      task.setNodeName(node.name());
      task.setAssigneeId(user.getId());
      task.setAssigneeName(user.getNickname());
      task.setRunNumber(request.getRunNumber());
      task.setNodeVisit(token.getNodeVisit());
      task.setKind(node.type());
      task.setStatus(
          "COPY".equals(node.type())
              ? "COPIED"
              : "SERIAL".equals(node.mode()) && index++ > 0 ? "WAITING" : "PENDING");
      task.setDueAt(
          node.timeoutMinutes() == null
              ? null
              : LocalDateTime.now().plusMinutes(node.timeoutMinutes()));
      tasks.saveAndFlush(task);
      if (!"WAITING".equals(task.getStatus())) host.activate(request, task);
    }
    if ("COPY".equals(node.type())) token.setNodeId(node.next());
    else {
      token.setStatus("APPROVAL");
      token.getTrail().add(node.id());
      request.setActivePath(json.write(Map.of("nodes", statePath(request, token))));
    }
  }

  private List<String> statePath(FlowRequest request, Token current) {
    var nodes = new LinkedHashSet<String>();
    var state = json.execution(request.getExecutionState());
    if (state != null) state.getTokens().forEach(token -> nodes.addAll(token.getTrail()));
    nodes.addAll(current.getTrail());
    return new ArrayList<>(nodes);
  }

  private void subprocess(
      FlowRequest parent,
      WorkflowExecutionState state,
      Token token,
      Node node,
      WorkflowEngine host) {
    if (token.getChildRequestId() != null) {
      var child =
          requests
              .findById(token.getChildRequestId())
              .orElseThrow(() -> new BusinessException("子流程申请不存在"));
      if (!"APPROVED".equals(child.getStatus())) {
        token.setStatus("WAIT_CHILD");
        return;
      }
      var parentForm = new LinkedHashMap<>(host.values(parent));
      var childForm = host.values(child);
      node.subprocess()
          .outputs()
          .forEach((target, source) -> parentForm.put(target, childForm.get(source)));
      var normalized = WorkflowSchema.form(host.schema(parent), parentForm);
      host.validateAssociations(host.schema(parent), normalized, host.values(parent));
      parent.setFormData(json.write(normalized));
      parent.getAttachmentIds().addAll(host.fileIds(host.schema(parent), normalized));
      host.record(parent, "SUBPROCESS_RESULT", node, "固定子流程已通过，输出字段已回填", null);
      token.setNodeId(node.next());
      token.setChildRequestId(null);
      return;
    }
    var version = definitions.subprocessVersion(node.subprocess().versionId());
    Spec childSpec = json.spec(version.getSchemaJson());
    var applicant =
        users
            .findById(parent.getApplicantId())
            .filter(user -> user.isEnabled() && access.hasFor(user, "requests:create"))
            .orElseThrow(() -> new BusinessException("原申请人已停用或发起权限失效"));
    var overrides = subprocessRepair.overrides(parent, node.id());
    var people = definitions.resolveSubprocess(childSpec, applicant, overrides);
    Map<String, Object> input = new LinkedHashMap<>();
    node.subprocess()
        .inputs()
        .forEach((target, source) -> input.put(target, host.values(parent).get(source)));
    var form = WorkflowSchema.form(childSpec, input);
    // 输入附件只来自父申请已核验的引用；子节点不能通过映射引入父申请以外的对象。
    var attachments = host.fileIds(childSpec, form);
    if (!parent.getAttachmentIds().containsAll(attachments))
      throw new BusinessException("子流程输入包含父申请未登记附件");
    int depth = 0;
    var cursor = parent;
    while (cursor.getParentRequestId() != null) {
      if (++depth >= 4) throw new BusinessException("子流程嵌套超过安全上限");
      cursor = requests.findById(cursor.getParentRequestId()).orElseThrow();
    }
    var child = new FlowRequest();
    child.setParentRequestId(parent.getId());
    child.setParentTokenId(token.getId());
    child.setRootRequestId(parent.getRootRequestId());
    child.setDefinitionId(version.getDefinitionId());
    child.setDefinitionName(definitions.find(version.getDefinitionId(), false).getName());
    child.setDefinitionVersionId(version.getId());
    child.setSchemaSnapshot(version.getSchemaJson());
    child.setResolvedAssignees(json.write(people));
    child.setAssignmentOverrides(json.write(overrides));
    child.setTitle(
        (parent.getTitle() + " · " + node.name())
            .substring(0, Math.min(160, (parent.getTitle() + " · " + node.name()).length())));
    child.setContent("");
    child.setApplicantId(parent.getApplicantId());
    child.setApplicantName(parent.getApplicantName());
    child.setStatus("PENDING");
    child.setFormData(json.write(form));
    child.setSubmittedFormData(child.getFormData());
    child.setSubmittedAt(LocalDateTime.now());
    child.setAttachmentIds(attachments);
    requests.saveAndFlush(child);
    token.setChildRequestId(child.getId());
    token.setStatus("WAIT_CHILD");
    parent.setExecutionState(json.write(state));
    host.record(parent, "SUBPROCESS_START", node, "启动固定版本子流程", null);
    host.record(child, "SUBMIT", null, "由父流程节点启动", null);
    // 子申请始终使用游标运行端，使失败可恢复、完成可唤醒父调用，旧根单线实例仍保持旧语义。
    enter(child, childSpec.startNodeId(), host);
    host.refreshParticipants(child);
  }

  private void cancelTasksAndChildren(
      FlowRequest request, Set<String> tokenIds, WorkflowEngine host) {
    tasks.findByRequestIdOrderByIdAsc(request.getId()).stream()
        .filter(
            task ->
                tokenIds.contains(task.getExecutionTokenId())
                    && Set.of("PENDING", "WAITING").contains(task.getStatus()))
        .forEach(task -> task.setStatus("CANCELLED"));
    for (var child : requests.findByParentRequestIdOrderByIdAsc(request.getId()))
      if (tokenIds.contains(child.getParentTokenId()) && "PENDING".equals(child.getStatus()))
        host.finish(requests.lockById(child.getId()).orElseThrow(), "CANCELLED", false);
  }
}
