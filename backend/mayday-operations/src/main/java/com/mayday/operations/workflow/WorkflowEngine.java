package com.mayday.operations.workflow;

import com.mayday.common.*;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.operations.workflow.WorkflowSchema.*;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.*;
import com.mayday.system.repository.*;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 无循环审批引擎。申请主记录行锁把会签、或签、转交、加签和撤回串行化，版本号防止旧弹窗误处理。 人员快照只是任务归属，不是永久授权；所有动作同时检查当前账号权限、当前节点动作及字段可写范围。
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WorkflowEngine implements FileUsage {
  private final FlowRequestRepository requests;
  private final FlowTaskRepository tasks;
  private final FlowDecisionRepository history;
  private final FlowVersionRepository versions;
  private final WorkflowDefinitions definitions;
  private final WorkflowJson json;
  private final UserRepository users;
  private final EntryRepository entries;
  private final StoredFileRepository files;
  private final AccessPolicy access;
  private final WorkflowEvents events;
  private final List<WorkflowBusiness> businesses;

  public record Submit(
      @NotNull Long definitionId,
      @NotNull Long versionId,
      @NotBlank @Size(max = 160) String title,
      Map<String, Object> values,
      Long businessId,
      Long businessRevisionId,
      Long businessVersion) {}

  public record Action(
      @NotNull Long version,
      @NotBlank @Pattern(regexp = "APPROVE|REJECT|WITHDRAW|COMMENT|TRANSFER|ADD_SIGN")
          String action,
      @Size(max = 500) String comment,
      Long taskId,
      Long targetUserId,
      Map<String, Object> values) {}

  private WorkflowBusiness business(String type) {
    return businesses.stream()
        .filter(b -> b.type().equals(type))
        .findFirst()
        .orElseThrow(() -> new BusinessException("业务审核尚未接入"));
  }

  public Spec schema(FlowRequest r) {
    return r.getSchemaSnapshot() == null
        ? WorkflowDefinitions.legacy(r.getApproverIds())
        : json.spec(r.getSchemaSnapshot());
  }

  public Map<String, Object> values(FlowRequest r) {
    return r.getFormData() == null ? Map.of("content", r.getContent()) : json.form(r.getFormData());
  }

  private boolean participant(FlowRequest r) {
    return Objects.equals(r.getApplicantId(), access.current().getId())
        || r.getApproverIds().contains(access.current().getId())
        || access.has("requests:manage");
  }

  public FlowRequest accessible(Long id, boolean lock) {
    access.require("requests:view");
    var r =
        (lock ? requests.lockById(id) : requests.findById(id))
            .orElseThrow(() -> new BusinessException("审批申请不存在"));
    if (!participant(r)) throw new AccessDeniedException("不在此审批的参与范围");
    return r;
  }

  public Specification<FlowRequest> filter(String keyword, String box) {
    access.require("requests:view");
    Long uid = access.current().getId();
    if (!Set.of("mine", "todo", "done", "participated", "all").contains(box))
      throw new BusinessException("未知审批筛选");
    if (box.equals("all")) access.require("requests:manage");
    if (box.equals("todo") || box.equals("done")) access.require("requests:approve");
    return (r, q, c) -> {
      var base = SearchPredicates.contains(c, r.get("title"), keyword);
      if (box.equals("all")) return base;
      if (box.equals("mine")) return c.and(base, c.equal(r.get("applicantId"), uid));
      if (box.equals("participated")) return c.and(base, c.isMember(uid, r.get("approverIds")));
      var sub = q.subquery(Long.class);
      var task = sub.from(FlowTask.class);
      var state =
          box.equals("todo")
              ? c.equal(task.get("status"), "PENDING")
              : task.get("status").in("APPROVED", "REJECTED", "TRANSFERRED");
      sub.select(task.get("requestId")).where(c.equal(task.get("assigneeId"), uid), state);
      var match = r.get("id").in(sub);
      if (box.equals("todo"))
        return c.and(
            base,
            c.equal(r.get("status"), "PENDING"),
            c.or(
                match,
                c.and(
                    c.isNull(r.get("schemaSnapshot")), c.equal(r.get("currentApproverId"), uid))));
      return c.and(base, match);
    };
  }

  public Map<String, Object> summary(FlowRequest r) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", r.getId());
    out.put("version", r.getVersion());
    out.put("createdAt", r.getCreatedAt());
    out.put("updatedAt", r.getUpdatedAt());
    out.put("title", r.getTitle());
    out.put("definitionName", r.getDefinitionName());
    out.put("definitionId", r.getDefinitionId());
    out.put("definitionVersionId", r.getDefinitionVersionId());
    out.put("applicantId", r.getApplicantId());
    out.put("applicantName", r.getApplicantName());
    out.put("status", r.getStatus());
    out.put("businessType", r.getBusinessType());
    out.put(
        "definitionVersionNumber",
        r.getDefinitionVersionId() == null
            ? null
            : versions
                .findById(r.getDefinitionVersionId())
                .map(FlowVersion::getVersionNumber)
                .orElse(null));
    out.put("businessId", r.getBusinessId());
    out.put("businessRevisionId", r.getBusinessRevisionId());
    out.put("completedAt", r.getCompletedAt());
    out.put("currentNodeId", r.getCurrentNodeId());
    out.put(
        "currentNodeName",
        r.getCurrentNodeId() == null ? null : schema(r).node(r.getCurrentNodeId()).name());
    return out;
  }

  /** 查看人只能得到本人节点可读字段；接口不返回原始模型中的所有字段值。管理员全量查看单独授权。 */
  public Map<String, Object> detail(Long id) {
    var r = accessible(id, false);
    var spec = schema(r);
    var out = summary(r);
    var requestTasks = tasks.findByRequestIdOrderByIdAsc(id);
    Set<String> readable = readable(r, spec, requestTasks);
    var currentValues = values(r);
    Map<String, Object> visible = new LinkedHashMap<>();
    readable.forEach(key -> visible.put(key, currentValues.get(key)));
    out.put("fields", spec.fields().stream().filter(f -> readable.contains(f.id())).toList());
    out.put("values", visible);
    out.put("tasks", requestTasks);
    out.put("files", files.findAllById(fileIds(spec, visible)));
    Map<String, String> labels = new LinkedHashMap<>();
    for (Field f : spec.fields())
      if (visible.get(f.id()) != null) {
        if (f.type().equals("USER"))
          labels.put(
              f.id(),
              users
                  .findById(WorkflowSchema.positiveId(visible.get(f.id()), f.label()))
                  .map(SysUser::getNickname)
                  .orElse("已删除人员"));
        if (f.type().equals("DEPARTMENT"))
          labels.put(
              f.id(),
              entries
                  .findById(WorkflowSchema.positiveId(visible.get(f.id()), f.label()))
                  .map(SystemEntry::getName)
                  .orElse("已删除部门"));
      }
    out.put("valueLabels", labels);
    out.put(
        "history",
        history
            .findAll(
                (a, q, c) -> c.equal(a.get("requestId"), id),
                org.springframework.data.domain.Sort.by("id"))
            .stream()
            .map(d -> historyView(d, readable))
            .toList());
    var mine =
        requestTasks.stream()
            .filter(
                task ->
                    task.getAssigneeId().equals(access.current().getId())
                        && "PENDING".equals(task.getStatus()))
            .findFirst()
            .orElse(null);
    Node node = mine == null ? null : spec.node(mine.getNodeId());
    out.put("myTaskId", mine == null ? null : mine.getId());
    out.put("actions", node == null || !access.has("requests:approve") ? Set.of() : node.actions());
    out.put(
        "writable", node == null || !access.has("requests:approve") ? Set.of() : node.writable());
    out.put(
        "canWithdraw",
        "PENDING".equals(r.getStatus())
            && Objects.equals(r.getApplicantId(), access.current().getId())
            && access.has("requests:create")
            && !Boolean.FALSE.equals(spec.allowWithdraw()));
    out.put(
        "canComment",
        "PENDING".equals(r.getStatus())
            && ((Objects.equals(r.getApplicantId(), access.current().getId())
                    && access.has("requests:create"))
                || (node != null
                    && access.has("requests:approve")
                    && node.actions().contains("COMMENT"))));
    out.put(
        "business",
        r.getBusinessType().equals("GENERAL") ? null : business(r.getBusinessType()).detail(r));
    return out;
  }

  /** 历史中的字段值采用与详情相同的可读范围，防止借助审计记录绕过字段保护。 */
  private Map<String, Object> historyView(FlowDecision d, Set<String> readable) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", d.getId());
    out.put("createdAt", d.getCreatedAt());
    out.put("actorName", d.getActorName());
    out.put("action", d.getAction());
    out.put("comment", d.getComment());
    out.put("nodeName", d.getNodeName());
    out.put("targetUserName", d.getTargetUserName());
    var changes =
        d.getChangesJson() == null
            ? new LinkedHashMap<String, Object>()
            : new LinkedHashMap<>(json.form(d.getChangesJson()));
    changes.keySet().retainAll(readable);
    out.put("changes", changes);
    return out;
  }

  private Set<String> readable(FlowRequest r, Spec s, List<FlowTask> requestTasks) {
    if (access.has("requests:manage")
        || Objects.equals(r.getApplicantId(), access.current().getId()))
      return new LinkedHashSet<>(s.fields().stream().map(Field::id).toList());
    Set<String> result = new LinkedHashSet<>();
    for (var task : requestTasks)
      if (task.getAssigneeId().equals(access.current().getId()))
        result.addAll(s.node(task.getNodeId()).readable());
    return result;
  }

  @Transactional
  public Map<String, Object> submit(Submit input) {
    access.require("requests:view");
    access.require("requests:create");
    var definition = definitions.find(input.definitionId(), true);
    if (!definition.isEnabled() || definition.getPublishedVersionId() == null)
      throw new BusinessException("流程尚未发布或已停用");
    if (!Objects.equals(definition.getPublishedVersionId(), input.versionId()))
      throw new org.springframework.dao.OptimisticLockingFailureException("流程发布版本已变化，请重新打开申请");
    var published = versions.findById(input.versionId()).orElseThrow();
    var spec = json.spec(published.getSchemaJson());
    var resolved = definitions.resolve(spec, access.current());
    var form = WorkflowSchema.form(spec, input.values());
    validateAssociations(spec, form, Map.of());
    var r = new FlowRequest();
    r.setDefinitionId(definition.getId());
    r.setDefinitionName(definition.getName());
    r.setDefinitionVersionId(published.getId());
    r.setSchemaSnapshot(published.getSchemaJson());
    r.setFormData(json.write(form));
    r.setSubmittedFormData(r.getFormData());
    r.setResolvedAssignees(json.write(resolved));
    r.setTitle(input.title().trim());
    r.setContent("");
    r.setApplicantId(access.current().getId());
    r.setApplicantName(access.current().getNickname());
    r.setStatus("PENDING");
    r.setBusinessType(definition.getBusinessType());
    r.setBusinessId(input.businessId());
    r.setBusinessRevisionId(input.businessRevisionId());
    r.setAttachmentIds(fileIds(spec, form));
    requests.saveAndFlush(r);
    if (!"GENERAL".equals(r.getBusinessType()))
      business(r.getBusinessType()).submitted(r, input.businessVersion());
    else if (input.businessId() != null || input.businessRevisionId() != null)
      throw new BusinessException("通用审批不能冒用业务关联");
    record(r, "SUBMIT", null, "发起申请", null);
    advance(r, spec.startNodeId());
    requests.flush();
    return detail(r.getId());
  }

  /** 动态字段关联使用最小权限。修改保留原附件无需重新获得上传者权限，新增关联必须拥有文件。 */
  private void validateAssociations(
      Spec spec, Map<String, Object> values, Map<String, Object> old) {
    for (Field field : spec.fields()) {
      Object value = values.get(field.id());
      if (value == null || Objects.equals(value, old.get(field.id()))) continue;
      if ("USER".equals(field.type())) {
        access.require("users:view");
        var user =
            users
                .findById(WorkflowSchema.positiveId(value, field.label()))
                .filter(SysUser::isEnabled)
                .orElseThrow(() -> new BusinessException("表单引用的人员无效"));
        access.checkData("users", user.getId(), user.getDepartmentId());
      }
      if ("DEPARTMENT".equals(field.type()))
        entries
            .findById(WorkflowSchema.positiveId(value, field.label()))
            .filter(e -> e.isEnabled() && e.getKind().equals("departments"))
            .orElseThrow(() -> new BusinessException("表单引用的部门无效"));
      if ("FILES".equals(field.type())) {
        Set<Long> previous = new HashSet<>();
        if (old.get(field.id()) instanceof List<?> list)
          list.forEach(v -> previous.add(WorkflowSchema.positiveId(v, field.label())));
        for (Object id : (List<?>) value) {
          Long fid = WorkflowSchema.positiveId(id, field.label());
          if (previous.contains(fid)) continue;
          var file = files.findById(fid).orElseThrow(() -> new BusinessException("附件不存在"));
          if (!Objects.equals(file.getOwnerId(), access.current().getId())
              && !access.has("files:all")) throw new AccessDeniedException("不能关联其他人上传的附件");
        }
      }
    }
  }

  private Set<Long> fileIds(Spec spec, Map<String, Object> values) {
    Set<Long> result = new HashSet<>();
    for (Field field : spec.fields())
      if ("FILES".equals(field.type()) && values.get(field.id()) instanceof List<?> list)
        list.forEach(id -> result.add(WorkflowSchema.positiveId(id, field.label())));
    return result;
  }

  public void checkFile(Long requestId, Long fileId) {
    var r = accessible(requestId, false);
    var s = schema(r);
    var readable = readable(r, s, tasks.findByRequestIdOrderByIdAsc(requestId));
    var form = values(r);
    boolean allowed =
        s.fields().stream()
            .filter(f -> readable.contains(f.id()) && "FILES".equals(f.type()))
            .anyMatch(
                f ->
                    form.get(f.id()) instanceof List<?> list
                        && list.stream()
                            .anyMatch(
                                id -> WorkflowSchema.positiveId(id, f.label()).equals(fileId)));
    if (!allowed) throw new AccessDeniedException("当前节点无权读取此附件");
  }

  @Override
  public boolean referenced(Long id) {
    return requests.existsByAttachmentIdsContains(id);
  }

  /** 新节点只创建当前待办，未来节点人员不是当前实例参与者，不能提前读取表单。 */
  private void advance(FlowRequest r, String next) {
    var s = schema(r);
    var assignments = json.assignees(r.getResolvedAssignees());
    var form = values(r);
    for (int hops = 0; hops <= s.nodes().size(); hops++) {
      Node n = s.node(next);
      if ("END".equals(n.type())) {
        finish(r, "APPROVED");
        return;
      }
      if ("CONDITION".equals(n.type())) {
        next = WorkflowSchema.next(n, form);
        continue;
      }
      List<Long> ids = assignments.get(n.id());
      if (ids == null || ids.isEmpty()) throw new BusinessException("节点缺少审批人快照");
      for (Long id : ids) {
        var user =
            users
                .findById(id)
                .filter(u -> access.hasFor(u, "requests:approve"))
                .orElseThrow(() -> new BusinessException("下一节点审批人权限已失效，请联系管理员恢复或撤回申请"));
        var task = new FlowTask();
        task.setRequestId(r.getId());
        task.setNodeId(n.id());
        task.setNodeName(n.name());
        task.setAssigneeId(id);
        task.setAssigneeName(user.getNickname());
        tasks.saveAndFlush(task);
        if (!r.getApproverIds().contains(id)) r.getApproverIds().add(id);
        events.enqueue(r, id, "request:" + r.getId() + ":task:" + task.getId(), "你有一项待处理审批");
      }
      r.setCurrentNodeId(n.id());
      r.setCurrentApproverId(ids.getFirst());
      return;
    }
    throw new BusinessException("流程路径无法结束");
  }

  private void finish(FlowRequest r, String status) {
    r.setStatus(status);
    r.setCompletedAt(LocalDateTime.now());
    r.setCurrentNodeId(null);
    r.setCurrentApproverId(null);
    for (var task : tasks.findByRequestIdOrderByIdAsc(r.getId()))
      if (task.getStatus().equals("PENDING")) task.setStatus("CANCELLED");
    if (!r.getBusinessType().equals("GENERAL")) business(r.getBusinessType()).completed(r);
    String label =
        switch (status) {
          case "APPROVED" -> "审批已通过";
          case "REJECTED" -> "审批已驳回";
          default -> "审批已撤回";
        };
    events.enqueue(r, r.getApplicantId(), "request:" + r.getId() + ":result", label);
  }

  private FlowDecision record(
      FlowRequest r, String action, Node node, String comment, SysUser target) {
    var d = new FlowDecision();
    d.setRequestId(r.getId());
    d.setActorId(access.current().getId());
    d.setActorName(access.current().getNickname());
    d.setAction(action);
    d.setComment(comment);
    if (node != null) {
      d.setNodeId(node.id());
      d.setNodeName(node.name());
    }
    if (target != null) {
      d.setTargetUserId(target.getId());
      d.setTargetUserName(target.getNickname());
    }
    return history.save(d);
  }

  // 决策统一入口在同一行锁事务内执行，任何业务回调失败都回滚任务与历史。
  @Transactional
  public Map<String, Object> act(Long id, Action input) {
    var r = accessible(id, true);
    OperationSupport.version(r, input.version());
    if (!r.getStatus().equals("PENDING")) throw new BusinessException("申请已经结束");
    var spec = schema(r);
    String action = input.action();
    Long uid = access.current().getId();
    if (action.equals("WITHDRAW")) {
      access.require("requests:create");
      if (!Objects.equals(r.getApplicantId(), uid) || Boolean.FALSE.equals(spec.allowWithdraw()))
        throw new AccessDeniedException("当前申请不允许你撤回");
      if (input.values() != null && !input.values().isEmpty())
        throw new BusinessException("撤回不能修改表单");
      finish(r, "WITHDRAWN");
      record(r, action, null, input.comment(), null);
    } else if (action.equals("COMMENT") && Objects.equals(r.getApplicantId(), uid)) {
      access.require("requests:create");
      if (input.comment() == null || input.comment().isBlank())
        throw new BusinessException("请输入评论");
      if (input.values() != null && !input.values().isEmpty())
        throw new BusinessException("评论不能修改表单");
      record(r, action, null, input.comment(), null);
      r.setUpdatedAt(LocalDateTime.now());
    } else {
      access.require("requests:approve");
      var current = tasks.findByRequestIdOrderByIdAsc(id);
      var task =
          current.stream()
              .filter(
                  t ->
                      Objects.equals(t.getId(), input.taskId())
                          && t.getAssigneeId().equals(uid)
                          && t.getStatus().equals("PENDING")
                          && t.getNodeId().equals(r.getCurrentNodeId()))
              .findFirst()
              .orElseThrow(() -> new AccessDeniedException("不是当前待办处理人"));
      Node node = spec.node(task.getNodeId());
      if (!node.actions().contains(action)) throw new AccessDeniedException("当前节点不允许此操作");
      if (!Boolean.TRUE.equals(spec.allowSelfApproval()) && uid.equals(r.getApplicantId()))
        throw new AccessDeniedException("流程不允许自我审批");
      Map<String, Object> changes = new LinkedHashMap<>();
      if (input.values() != null && !input.values().isEmpty()) {
        if (!Set.of("APPROVE", "REJECT").contains(action)
            || !node.writable().containsAll(input.values().keySet()))
          throw new AccessDeniedException("包含不可写字段");
        var old = values(r);
        var candidate = new LinkedHashMap<>(old);
        candidate.putAll(input.values());
        var form = WorkflowSchema.form(spec, candidate);
        for (String key : input.values().keySet())
          if (!Objects.equals(old.get(key), form.get(key))) {
            var change = new LinkedHashMap<String, Object>();
            change.put("before", old.get(key));
            change.put("after", form.get(key));
            changes.put(key, change);
          }
        validateAssociations(spec, form, old);
        r.setFormData(json.write(form));
        r.getAttachmentIds().addAll(fileIds(spec, form));
      }
      SysUser target = null;
      switch (action) {
        case "COMMENT" -> {
          if (input.comment() == null || input.comment().isBlank())
            throw new BusinessException("请输入评论");
        }
        case "REJECT" -> {
          if (input.comment() == null || input.comment().isBlank())
            throw new BusinessException("请输入驳回原因");
          task.setStatus("REJECTED");
          task.setDecidedAt(LocalDateTime.now());
          finish(r, "REJECTED");
        }
        case "APPROVE" -> {
          task.setStatus("APPROVED");
          task.setDecidedAt(LocalDateTime.now());
          tasks.flush();
          var group =
              tasks.findByRequestIdOrderByIdAsc(id).stream()
                  .filter(t -> t.getNodeId().equals(node.id()))
                  .toList();
          boolean mandatory =
              group.stream()
                  .filter(FlowTask::isMandatory)
                  .anyMatch(t -> t.getStatus().equals("PENDING"));
          boolean ready =
              node.mode().equals("ALL")
                  ? group.stream().noneMatch(t -> t.getStatus().equals("PENDING"))
                  : !mandatory
                      && group.stream()
                          .anyMatch(t -> !t.isMandatory() && t.getStatus().equals("APPROVED"));
          if (ready) {
            group.stream()
                .filter(t -> t.getStatus().equals("PENDING"))
                .forEach(t -> t.setStatus("CANCELLED"));
            advance(r, node.next());
          }
        }
        case "TRANSFER", "ADD_SIGN" -> {
          if (input.targetUserId() == null) throw new BusinessException("请选择接收人");
          target =
              users
                  .findById(input.targetUserId())
                  .filter(u -> access.hasFor(u, "requests:approve"))
                  .orElseThrow(() -> new BusinessException("接收人必须启用且具有审批权限"));
          access.require("users:view");
          access.checkData("users", target.getId(), target.getDepartmentId());
          if (target.getId().equals(uid)
              || (!Boolean.TRUE.equals(spec.allowSelfApproval())
                  && target.getId().equals(r.getApplicantId())))
            throw new BusinessException("不能转给自己或不允许自审的申请人");
          Long targetId = target.getId();
          if (!Boolean.TRUE.equals(spec.allowRepeatApproval())
              && json.assignees(r.getResolvedAssignees()).entrySet().stream()
                  .anyMatch(e -> !e.getKey().equals(node.id()) && e.getValue().contains(targetId)))
            throw new BusinessException("接收人已被其他节点指定，流程不允许重复审批");
          if (current.stream()
              .anyMatch(
                  t ->
                      t.getAssigneeId().equals(targetId)
                          && (t.getNodeId().equals(node.id())
                              || (!Boolean.TRUE.equals(spec.allowRepeatApproval())
                                  && t.getStatus().equals("APPROVED")))))
            throw new BusinessException("接收人已参与当前节点或不允许重复审批");
          var added = new FlowTask();
          added.setRequestId(id);
          added.setNodeId(node.id());
          added.setNodeName(node.name());
          added.setAssigneeId(targetId);
          added.setAssigneeName(target.getNickname());
          added.setMandatory(action.equals("ADD_SIGN") || task.isMandatory());
          tasks.saveAndFlush(added);
          if (action.equals("TRANSFER")) {
            task.setStatus("TRANSFERRED");
            task.setDecidedAt(LocalDateTime.now());
          }
          if (!r.getApproverIds().contains(targetId)) r.getApproverIds().add(targetId);
          events.enqueue(
              r,
              targetId,
              "request:" + id + ":task:" + added.getId(),
              action.equals("TRANSFER") ? "你收到一项转交审批" : "你收到一项加签审批");
        }
        default -> throw new BusinessException("不支持的审批动作");
      }
      var decision = record(r, action, node, input.comment(), target);
      decision.setChangesJson(changes.isEmpty() ? null : json.write(changes));
      r.setUpdatedAt(LocalDateTime.now());
    }
    requests.flush();
    return detail(id);
  }
}
