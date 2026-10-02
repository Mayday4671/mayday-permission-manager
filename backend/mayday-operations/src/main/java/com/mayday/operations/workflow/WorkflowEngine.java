package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.common.FileUsage;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.FlowDecision;
import com.mayday.operations.model.FlowRequest;
import com.mayday.operations.model.FlowTask;
import com.mayday.operations.model.FlowVersion;
import com.mayday.operations.realtime.RealtimeEvents;
import com.mayday.operations.repository.FlowDecisionRepository;
import com.mayday.operations.repository.FlowRequestRepository;
import com.mayday.operations.repository.FlowTaskRepository;
import com.mayday.operations.repository.FlowVersionRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.operations.storage.StoredFileContent;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.UserRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
  private final RealtimeEvents realtime;
  private final List<WorkflowBusiness> businesses;

  /** 提交只接受已发布版本编号，人员、节点和账号身份由服务端解析并冻结。 */
  @Schema(name = "WorkflowSubmission")
  public record Submit(
      @NotNull Long definitionId,
      @NotNull Long versionId,
      @NotBlank @Size(max = 160) String title,
      Map<String, Object> values,
      Long businessId,
      Long businessRevisionId,
      Long businessVersion) {}

  /** 所有决定携带申请版本；转交/加签仅目标账号有效，其他动作不能通过额外属性改写身份。 */
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

  /** 读取实例快照；仅尚未迁移的旧申请回退为原顺序模型，不查询正在编辑的流程草稿。 */
  public Spec schema(FlowRequest request) {
    return request.getSchemaSnapshot() == null
        ? WorkflowDefinitions.legacy(request.getApproverIds())
        : json.spec(request.getSchemaSnapshot());
  }

  /** 实例当前表单与原始提交分开存储，旧申请正文映射为固定 content 字段。 */
  public Map<String, Object> values(FlowRequest request) {
    return request.getFormData() == null
        ? Map.of("content", request.getContent())
        : json.form(request.getFormData());
  }

  private boolean participant(FlowRequest request) {
    return Objects.equals(request.getApplicantId(), access.current().getId())
        || request.getApproverIds().contains(access.current().getId())
        || access.has("requests:manage");
  }

  /** 查询与决策共用参与范围；lock=true 用于串行化当前申请全部节点的状态变更。 */
  public FlowRequest accessible(Long id, boolean lock) {
    access.require("requests:view");
    var request =
        (lock ? requests.lockById(id) : requests.findById(id))
            .orElseThrow(() -> new BusinessException("审批申请不存在"));
    if (!participant(request)) throw new AccessDeniedException("不在此审批的参与范围");
    return request;
  }

  /** 待办在 SQL 中按当前账号任务过滤；全量管理需独立权限，不能分页后再在浏览器裁剪。 */
  public Specification<FlowRequest> filter(String keyword, String box) {
    access.require("requests:view");
    Long userId = access.current().getId();
    if (!Set.of("mine", "todo", "done", "participated", "all").contains(box))
      throw new BusinessException("未知审批筛选");
    if (box.equals("all")) access.require("requests:manage");
    if (box.equals("todo") || box.equals("done")) access.require("requests:approve");
    return (request, q, c) -> {
      var base = SearchPredicates.contains(c, request.get("title"), keyword);
      if (box.equals("all")) return base;
      if (box.equals("mine")) return c.and(base, c.equal(request.get("applicantId"), userId));
      if (box.equals("participated"))
        return c.and(base, c.isMember(userId, request.get("approverIds")));
      var sub = q.subquery(Long.class);
      var task = sub.from(FlowTask.class);
      var state =
          box.equals("todo")
              ? c.equal(task.get("status"), "PENDING")
              : task.get("status").in("APPROVED", "REJECTED", "TRANSFERRED");
      sub.select(task.get("requestId")).where(c.equal(task.get("assigneeId"), userId), state);
      var match = request.get("id").in(sub);
      if (box.equals("todo"))
        return c.and(
            base,
            c.equal(request.get("status"), "PENDING"),
            c.or(
                match,
                c.and(
                    c.isNull(request.get("schemaSnapshot")),
                    c.equal(request.get("currentApproverId"), userId))));
      return c.and(base, match);
    };
  }

  /** 列表只提供申请元信息，不包含表单正文、附件内容及未来节点人员名单。 */
  public Map<String, Object> summary(FlowRequest request) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", request.getId());
    out.put("version", request.getVersion());
    out.put("createdAt", request.getCreatedAt());
    out.put("updatedAt", request.getUpdatedAt());
    out.put("title", request.getTitle());
    out.put("definitionName", request.getDefinitionName());
    out.put("definitionId", request.getDefinitionId());
    out.put("definitionVersionId", request.getDefinitionVersionId());
    out.put("applicantId", request.getApplicantId());
    out.put("applicantName", request.getApplicantName());
    out.put("status", request.getStatus());
    out.put("businessType", request.getBusinessType());
    out.put(
        "definitionVersionNumber",
        request.getDefinitionVersionId() == null
            ? null
            : versions
                .findById(request.getDefinitionVersionId())
                .map(FlowVersion::getVersionNumber)
                .orElse(null));
    out.put("businessId", request.getBusinessId());
    out.put("businessRevisionId", request.getBusinessRevisionId());
    out.put("completedAt", request.getCompletedAt());
    out.put("lastRemindedAt", request.getLastRemindedAt());
    out.put("currentNodeId", request.getCurrentNodeId());
    out.put(
        "currentNodeName",
        request.getCurrentNodeId() == null
            ? null
            : schema(request).node(request.getCurrentNodeId()).name());
    return out;
  }

  /** 查看人只能得到本人节点可读字段；接口不返回原始模型中的所有字段值。管理员全量查看单独授权。 */
  public Map<String, Object> detail(Long id) {
    var request = accessible(id, false);
    var spec = schema(request);
    var out = summary(request);
    var requestTasks = tasks.findByRequestIdOrderByIdAsc(id);
    Set<String> readable = readable(request, spec, requestTasks);
    var currentValues = values(request);
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
            .map(decision -> historyView(decision, readable))
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
        "PENDING".equals(request.getStatus())
            && Objects.equals(request.getApplicantId(), access.current().getId())
            && access.has("requests:create")
            && !Boolean.FALSE.equals(spec.allowWithdraw()));
    out.put(
        "canComment",
        "PENDING".equals(request.getStatus())
            && ((Objects.equals(request.getApplicantId(), access.current().getId())
                    && access.has("requests:create"))
                || (node != null
                    && access.has("requests:approve")
                    && node.actions().contains("COMMENT"))));
    out.put(
        "canRemind",
        "PENDING".equals(request.getStatus())
            && access.has("requests:remind")
            && (Objects.equals(request.getApplicantId(), access.current().getId())
                || access.has("requests:manage"))
            && (request.getLastRemindedAt() == null
                || !request.getLastRemindedAt().isAfter(LocalDateTime.now().minusMinutes(30))));
    out.put(
        "business",
        request.getBusinessType().equals("GENERAL")
            ? null
            : business(request.getBusinessType()).detail(request));
    return out;
  }

  /** 历史中的字段值采用与详情相同的可读范围，防止借助审计记录绕过字段保护。 */
  private Map<String, Object> historyView(FlowDecision decision, Set<String> readable) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", decision.getId());
    out.put("createdAt", decision.getCreatedAt());
    out.put("actorName", decision.getActorName());
    out.put("action", decision.getAction());
    out.put("comment", decision.getComment());
    out.put("nodeName", decision.getNodeName());
    out.put("targetUserName", decision.getTargetUserName());
    var changes =
        decision.getChangesJson() == null
            ? new LinkedHashMap<String, Object>()
            : new LinkedHashMap<>(json.form(decision.getChangesJson()));
    changes.keySet().retainAll(readable);
    out.put("changes", changes);
    return out;
  }

  private Set<String> readable(FlowRequest request, Spec schema, List<FlowTask> requestTasks) {
    if (access.has("requests:manage")
        || Objects.equals(request.getApplicantId(), access.current().getId()))
      return new LinkedHashSet<>(schema.fields().stream().map(Field::id).toList());
    Set<String> result = new LinkedHashSet<>();
    for (var task : requestTasks)
      if (task.getAssigneeId().equals(access.current().getId()))
        result.addAll(schema.node(task.getNodeId()).readable());
    return result;
  }

  /** 提交冻结发布版本和所有节点的人员解析结果；业务回调失败时任务、历史与消息一并回滚。 */
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
    var request = new FlowRequest();
    request.setDefinitionId(definition.getId());
    request.setDefinitionName(definition.getName());
    request.setDefinitionVersionId(published.getId());
    request.setSchemaSnapshot(published.getSchemaJson());
    request.setFormData(json.write(form));
    request.setSubmittedFormData(request.getFormData());
    request.setResolvedAssignees(json.write(resolved));
    request.setTitle(input.title().trim());
    request.setContent("");
    request.setApplicantId(access.current().getId());
    request.setApplicantName(access.current().getNickname());
    request.setStatus("PENDING");
    request.setBusinessType(definition.getBusinessType());
    request.setBusinessId(input.businessId());
    request.setBusinessRevisionId(input.businessRevisionId());
    request.setAttachmentIds(fileIds(spec, form));
    requests.saveAndFlush(request);
    if (!"GENERAL".equals(request.getBusinessType()))
      business(request.getBusinessType()).submitted(request, input.businessVersion());
    else if (input.businessId() != null || input.businessRevisionId() != null)
      throw new BusinessException("通用审批不能冒用业务关联");
    record(request, "SUBMIT", null, "发起申请", null);
    advance(request, spec.startNodeId());
    requests.flush();
    refreshParticipants(request);
    return detail(request.getId());
  }

  /** 动态字段关联使用最小权限。修改保留原附件无需重新获得上传者权限，新增关联必须拥有文件。 */
  private void validateAssociations(
      Spec spec, Map<String, Object> values, Map<String, Object> old) {
    // 在遍历字段前统一按编号锁定所有新附件，避免不同字段顺序造成锁顺序反转。
    Set<Long> additions = new HashSet<>();
    for (Field field : spec.fields()) {
      if (!"FILES".equals(field.type()) || !(values.get(field.id()) instanceof List<?> selected))
        continue;
      Set<Long> previous = new HashSet<>();
      if (old.get(field.id()) instanceof List<?> original)
        original.forEach(value -> previous.add(WorkflowSchema.positiveId(value, field.label())));
      selected.stream()
          .map(value -> WorkflowSchema.positiveId(value, field.label()))
          .filter(fileId -> !previous.contains(fileId))
          .forEach(additions::add);
    }
    Map<Long, com.mayday.operations.model.StoredFile> lockedFiles = new LinkedHashMap<>();
    for (Long fileId : additions.stream().sorted().toList()) {
      var file = files.lock(fileId).orElseThrow(() -> new BusinessException("附件不存在"));
      StoredFileContent.active(file);
      lockedFiles.put(fileId, file);
    }
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
          var file = lockedFiles.get(fid);
          if (file == null) throw new BusinessException("新增附件未通过关联校验");
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

  /** 附件下载仍按当前参与权和节点可读字段重新校验，文件编号不构成读取凭据。 */
  public void checkFile(Long requestId, Long fileId) {
    var request = accessible(requestId, false);
    var schema = schema(request);
    var readable = readable(request, schema, tasks.findByRequestIdOrderByIdAsc(requestId));
    var form = values(request);
    boolean allowed =
        schema.fields().stream()
            .filter(f -> readable.contains(f.id()) && "FILES".equals(f.type()))
            .anyMatch(
                f ->
                    form.get(f.id()) instanceof List<?> list
                        && list.stream()
                            .anyMatch(
                                id -> WorkflowSchema.positiveId(id, f.label()).equals(fileId)));
    if (!allowed) throw new AccessDeniedException("当前节点无权读取此附件");
  }

  /** 回收或删除文件前供文件模块检查历史申请引用，不能只检查当前表单值。 */
  @Override
  public boolean referenced(Long id) {
    return requests.existsByAttachmentIdsContains(id);
  }

  /** 新节点只创建当前待办，未来节点人员不是当前实例参与者，不能提前读取表单。 */
  private void advance(FlowRequest request, String next) {
    var schema = schema(request);
    var assignments = json.assignees(request.getResolvedAssignees());
    var form = values(request);
    for (int hops = 0; hops <= schema.nodes().size(); hops++) {
      Node node = schema.node(next);
      if ("END".equals(node.type())) {
        finish(request, "APPROVED");
        return;
      }
      if ("CONDITION".equals(node.type())) {
        next = WorkflowSchema.next(node, form);
        continue;
      }
      List<Long> ids = assignments.get(node.id());
      if (ids == null || ids.isEmpty()) throw new BusinessException("节点缺少审批人快照");
      for (Long id : ids) {
        var user =
            users
                .findById(id)
                .filter(u -> access.hasFor(u, "requests:approve"))
                .orElseThrow(() -> new BusinessException("下一节点审批人权限已失效，请联系管理员恢复或撤回申请"));
        var task = new FlowTask();
        task.setRequestId(request.getId());
        task.setNodeId(node.id());
        task.setNodeName(node.name());
        task.setAssigneeId(id);
        task.setAssigneeName(user.getNickname());
        task.setDueAt(
            node.timeoutMinutes() == null
                ? null
                : LocalDateTime.now().plusMinutes(node.timeoutMinutes()));
        tasks.saveAndFlush(task);
        if (!request.getApproverIds().contains(id)) request.getApproverIds().add(id);
        events.enqueue(
            request, id, "request:" + request.getId() + ":task:" + task.getId(), "你有一项待处理审批");
      }
      request.setCurrentNodeId(node.id());
      request.setCurrentApproverId(ids.getFirst());
      return;
    }
    throw new BusinessException("流程路径无法结束");
  }

  private void finish(FlowRequest request, String status) {
    request.setStatus(status);
    request.setCompletedAt(LocalDateTime.now());
    request.setCurrentNodeId(null);
    request.setCurrentApproverId(null);
    for (var task : tasks.findByRequestIdOrderByIdAsc(request.getId()))
      if (task.getStatus().equals("PENDING")) task.setStatus("CANCELLED");
    if (!request.getBusinessType().equals("GENERAL"))
      business(request.getBusinessType()).completed(request);
    String label =
        switch (status) {
          case "APPROVED" -> "审批已通过";
          case "REJECTED" -> "审批已驳回";
          default -> "审批已撤回";
        };
    events.enqueue(
        request, request.getApplicantId(), "request:" + request.getId() + ":result", label);
  }

  private FlowDecision record(
      FlowRequest request, String action, Node node, String comment, SysUser target) {
    var decision = new FlowDecision();
    decision.setRequestId(request.getId());
    decision.setActorId(access.current().getId());
    decision.setActorName(access.current().getNickname());
    decision.setAction(action);
    decision.setComment(comment);
    if (node != null) {
      decision.setNodeId(node.id());
      decision.setNodeName(node.name());
    }
    if (target != null) {
      decision.setTargetUserId(target.getId());
      decision.setTargetUserName(target.getNickname());
    }
    return history.save(decision);
  }

  /** 决策统一入口在同一行锁事务内执行，任何业务回调失败都回滚任务与历史。 */
  @Transactional
  public Map<String, Object> act(Long id, Action input) {
    var request = accessible(id, true);
    OperationSupport.version(request, input.version());
    if (!request.getStatus().equals("PENDING")) throw new BusinessException("申请已经结束");
    var spec = schema(request);
    String action = input.action();
    Long userId = access.current().getId();
    if (action.equals("WITHDRAW")) {
      access.require("requests:create");
      if (!Objects.equals(request.getApplicantId(), userId)
          || Boolean.FALSE.equals(spec.allowWithdraw()))
        throw new AccessDeniedException("当前申请不允许你撤回");
      if (input.values() != null && !input.values().isEmpty())
        throw new BusinessException("撤回不能修改表单");
      finish(request, "WITHDRAWN");
      record(request, action, null, input.comment(), null);
    } else if (action.equals("COMMENT") && Objects.equals(request.getApplicantId(), userId)) {
      access.require("requests:create");
      if (input.comment() == null || input.comment().isBlank())
        throw new BusinessException("请输入评论");
      if (input.values() != null && !input.values().isEmpty())
        throw new BusinessException("评论不能修改表单");
      record(request, action, null, input.comment(), null);
      request.setUpdatedAt(LocalDateTime.now());
    } else {
      access.require("requests:approve");
      var current = tasks.findByRequestIdOrderByIdAsc(id);
      var task =
          current.stream()
              .filter(
                  t ->
                      Objects.equals(t.getId(), input.taskId())
                          && t.getAssigneeId().equals(userId)
                          && t.getStatus().equals("PENDING")
                          && t.getNodeId().equals(request.getCurrentNodeId()))
              .findFirst()
              .orElseThrow(() -> new AccessDeniedException("不是当前待办处理人"));
      Node node = spec.node(task.getNodeId());
      if (!node.actions().contains(action)) throw new AccessDeniedException("当前节点不允许此操作");
      if (!Boolean.TRUE.equals(spec.allowSelfApproval()) && userId.equals(request.getApplicantId()))
        throw new AccessDeniedException("流程不允许自我审批");
      Map<String, Object> changes = new LinkedHashMap<>();
      if (input.values() != null && !input.values().isEmpty()) {
        if (!Set.of("APPROVE", "REJECT").contains(action)
            || !node.writable().containsAll(input.values().keySet()))
          throw new AccessDeniedException("包含不可写字段");
        var old = values(request);
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
        request.setFormData(json.write(form));
        request.getAttachmentIds().addAll(fileIds(spec, form));
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
          finish(request, "REJECTED");
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
            advance(request, node.next());
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
          if (target.getId().equals(userId)
              || (!Boolean.TRUE.equals(spec.allowSelfApproval())
                  && target.getId().equals(request.getApplicantId())))
            throw new BusinessException("不能转给自己或不允许自审的申请人");
          Long targetId = target.getId();
          if (!Boolean.TRUE.equals(spec.allowRepeatApproval())
              && json.assignees(request.getResolvedAssignees()).entrySet().stream()
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
          added.setDueAt(task.getDueAt());
          tasks.saveAndFlush(added);
          if (action.equals("TRANSFER")) {
            task.setStatus("TRANSFERRED");
            task.setDecidedAt(LocalDateTime.now());
          }
          if (!request.getApproverIds().contains(targetId)) request.getApproverIds().add(targetId);
          events.enqueue(
              request,
              targetId,
              "request:" + id + ":task:" + added.getId(),
              action.equals("TRANSFER") ? "你收到一项转交审批" : "你收到一项加签审批");
        }
        default -> throw new BusinessException("不支持的审批动作");
      }
      var decision = record(request, action, node, input.comment(), target);
      decision.setChangesJson(changes.isEmpty() ? null : json.write(changes));
      request.setUpdatedAt(LocalDateTime.now());
    }
    requests.flush();
    refreshParticipants(request);
    return detail(id);
  }

  /** 更新申请参与者的列表和工作台，未来节点未实际进入实例的人员不提前收到事件。 */
  private void refreshParticipants(FlowRequest request) {
    Set<Long> recipients = new HashSet<>(request.getApproverIds());
    recipients.add(request.getApplicantId());
    realtime.changed(recipients, "requests");
  }

  /** 催办不产生审批决定；申请人或独立授权的管理员只能提醒当前有效待办处理人。 */
  @Transactional
  public Map<String, Object> remind(Long id, Long version) {
    access.require("requests:remind");
    FlowRequest request = accessible(id, true);
    if (!Objects.equals(request.getApplicantId(), access.current().getId())
        && !access.has("requests:manage")) throw new AccessDeniedException("只有申请人或审批管理员可以催办");
    OperationSupport.version(request, version);
    if (!"PENDING".equals(request.getStatus())) throw new BusinessException("已结束申请不能催办");
    LocalDateTime now = LocalDateTime.now();
    if (request.getLastRemindedAt() != null
        && request.getLastRemindedAt().isAfter(now.minusMinutes(30)))
      throw new BusinessException("每项申请 30 分钟内只能催办一次");
    var pending =
        tasks.findByRequestIdOrderByIdAsc(id).stream()
            .filter(
                task ->
                    "PENDING".equals(task.getStatus())
                        && Objects.equals(task.getNodeId(), request.getCurrentNodeId()))
            .toList();
    if (pending.isEmpty()) throw new BusinessException("当前没有可催办的待办");
    // 使用锁内更新时间构造唯一键；重复请求由版本检查和时间窗拒绝，不再发送第二批消息。
    for (FlowTask task : pending)
      events.enqueue(
          request,
          task.getAssigneeId(),
          "reminder:" + id + ":" + task.getId() + ":" + now,
          request.getApplicantName() + "提醒你处理审批");
    request.setLastRemindedAt(now);
    record(request, "REMIND", null, "催办当前审批节点", null);
    requests.flush();
    refreshParticipants(request);
    return detail(id);
  }
}
