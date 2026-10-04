package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.FlowDefinition;
import com.mayday.operations.model.FlowVersion;
import com.mayday.operations.repository.FlowDefinitionRepository;
import com.mayday.operations.repository.FlowRequestRepository;
import com.mayday.operations.repository.FlowVersionRepository;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 流程定义管理与审批人解析。发布是单独授权动作，编辑草稿不会改变线上流程。 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WorkflowDefinitions {
  private final FlowDefinitionRepository definitions;
  private final FlowVersionRepository versions;
  private final FlowRequestRepository requests;
  private final UserRepository users;
  private final EntryRepository entries;
  private final RoleRepository roles;
  private final AccessPolicy access;
  private final WorkflowJson json;

  /** 草稿与发布分离；保存不会修改已发布版本，发布必须通过引用及图结构的完整校验。 */
  @Schema(name = "WorkflowDraft")
  public record Draft(
      @NotBlank @Size(max = 100) String name,
      @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{2,64}") String code,
      @Size(max = 500) String description,
      @NotNull Long categoryId,
      @NotNull @Pattern(regexp = "GENERAL|CONTENT") String businessType,
      @NotNull Boolean enabled,
      Spec schema,
      Long version) {}

  /** 服务内部定位定义；外部调用方先核验查看权限，写操作使用行锁及版本双重保护。 */
  public FlowDefinition find(Long id, boolean lock) {
    return (lock ? definitions.lockById(id) : definitions.findById(id))
        .orElseThrow(() -> new BusinessException("流程定义不存在"));
  }

  /** 回显草稿和可见人员标签，未知或越权账号不能通过设计权限变成可读通讯录数据。 */
  public Map<String, Object> view(FlowDefinition definition) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", definition.getId());
    out.put("version", definition.getVersion());
    out.put("createdAt", definition.getCreatedAt());
    out.put("updatedAt", definition.getUpdatedAt());
    out.put("name", definition.getName());
    out.put("code", definition.getCode());
    out.put("description", definition.getDescription());
    out.put("enabled", definition.isEnabled());
    out.put("categoryId", definition.getCategoryId());
    out.put(
        "category",
        definition.getCategoryId() == null
            ? "未分类"
            : entries.findById(definition.getCategoryId()).map(SystemEntry::getName).orElse("未分类"));
    out.put("businessType", definition.getBusinessType());
    out.put("publishedVersionId", definition.getPublishedVersionId());
    out.put(
        "publishedVersion",
        definition.getPublishedVersionId() == null
            ? null
            : versions
                .findById(definition.getPublishedVersionId())
                .map(FlowVersion::getVersionNumber)
                .orElse(null));
    var schema =
        definition.getDraftSchema() == null
            ? legacy(definition.getApproverIds())
            : json.spec(definition.getDraftSchema());
    out.put("schema", schema);
    Set<Long> personIds = new LinkedHashSet<>();
    if ("USERS".equals(schema.applicantType()) && schema.applicantIds() != null)
      personIds.addAll(schema.applicantIds());
    if (schema.nodes() != null)
      for (Node node : schema.nodes())
        if ("USERS".equals(node.source()) && node.assigneeIds() != null)
          personIds.addAll(node.assigneeIds());
    out.put(
        "personOptions",
        users.findAllById(personIds).stream()
            // 草稿模型由调用方提交，不能借回显任意人员 ID 来绕过用户选择器的范围限制。
            .filter(access::canViewUser)
            .map(
                user ->
                    Map.of(
                        "value",
                        user.getId(),
                        "label",
                        user.getNickname() + " · " + user.getUsername()))
            .toList());
    return out;
  }

  /** 草稿可暂存未完成的人员/节点配置；分类、业务类型和已有版本仍需要即时校验。 */
  @Transactional
  public Map<String, Object> save(Long id, Draft input) {
    access.require(id == null ? "workflows:create" : "workflows:update");
    access.require("workflows:view");
    var definition = id == null ? new FlowDefinition() : find(id, true);
    if (id != null) OperationSupport.version(definition, input.version());
    entries
        .findById(input.categoryId())
        .filter(e -> e.getKind().equals("approvalcategories") && e.isEnabled())
        .orElseThrow(() -> new BusinessException("请选择有效的审批分类"));
    if (definition.getPublishedVersionId() != null
        && !definition.getBusinessType().equals(input.businessType()))
      throw new BusinessException("已发布流程不能更换业务类型，请新建流程");
    // 草稿仍允许未配人员或连线，但不能通过保存接口静默删除已被单选条件使用的值。
    WorkflowSchema.validateDraft(input.schema());
    String schema =
        json.write(
            input.schema() == null
                ? new Spec(List.of(), List.of(), "", "ALL", Set.of(), false, false, true)
                : input.schema());
    if (schema.length() > 100000) throw new BusinessException("流程模型超过最大长度");
    definition.setName(input.name().trim());
    definition.setCode(input.code());
    definition.setDescription(input.description());
    definition.setCategoryId(input.categoryId());
    definition.setBusinessType(input.businessType());
    definition.setEnabled(input.enabled());
    definition.setDraftSchema(schema);
    definitions.saveAndFlush(definition);
    return view(definition);
  }

  /** 发布追加不可变版本，不覆盖历史；更新定义指向新版本仅影响后续提交的申请。 */
  @Transactional
  public Map<String, Object> publish(Long id, Long version) {
    access.require("workflows:view");
    access.require("workflows:publish");
    var definition = find(id, true);
    OperationSupport.version(definition, version);
    var schema =
        definition.getDraftSchema() == null
            ? legacy(definition.getApproverIds())
            : json.spec(definition.getDraftSchema());
    validateReferences(schema);
    var published = new FlowVersion();
    published.setDefinitionId(id);
    published.setVersionNumber(
        versions.findByDefinitionIdOrderByVersionNumberDesc(id).stream()
                .mapToInt(FlowVersion::getVersionNumber)
                .max()
                .orElse(0)
            + 1);
    published.setSchemaJson(json.write(schema));
    published.setPublisherName(access.current().getNickname());
    versions.saveAndFlush(published);
    definition.setPublishedVersionId(published.getId());
    definition.setDraftSchema(published.getSchemaJson());
    definitions.flush();
    return view(definition);
  }

  /** 图结构合法之后再核验账号、角色、部门和审批权限，防止保存不存在的运行依赖。 */
  public void validateReferences(Spec schema) {
    WorkflowSchema.validate(schema);
    if ("USERS".equals(schema.applicantType()))
      for (Long id : schema.applicantIds()) validUser(id, false);
    if ("ROLES".equals(schema.applicantType())) for (Long id : schema.applicantIds()) validRole(id);
    if ("DEPARTMENTS".equals(schema.applicantType()))
      for (Long id : schema.applicantIds()) validDepartment(id);
    for (Node node : schema.nodes())
      if (Set.of("APPROVAL", "COPY").contains(node.type())) {
        if ("USERS".equals(node.source()))
          for (Long id : node.assigneeIds()) validUser(id, "APPROVAL".equals(node.type()));
        if ("ROLES".equals(node.source())) for (Long id : node.assigneeIds()) validRole(id);
      }
  }

  private SysUser validUser(Long id, boolean approver) {
    var user =
        users
            .findById(id)
            .filter(SysUser::isEnabled)
            .orElseThrow(() -> new BusinessException("流程引用了不存在或停用的账号"));
    if (approver && !access.hasFor(user, "requests:approve"))
      throw new BusinessException("指定审批人缺少审批权限");
    return user;
  }

  private void validRole(Long id) {
    roles
        .findById(id)
        .filter(SysRole::isEnabled)
        .orElseThrow(() -> new BusinessException("流程引用了不存在或停用的角色"));
  }

  private void validDepartment(Long id) {
    entries
        .findById(id)
        .filter(e -> e.isEnabled() && e.getKind().equals("departments"))
        .orElseThrow(() -> new BusinessException("流程引用了不存在或停用的部门"));
  }

  /** 发起范围按当前账号与启用角色判断，客户端填写的 applicantIds 不是当前身份。 */
  public boolean canStart(Spec schema, SysUser applicant) {
    return switch (schema.applicantType()) {
      case "ALL" -> true;
      case "USERS" -> schema.applicantIds().contains(applicant.getId());
      case "DEPARTMENTS" ->
          applicant.getDepartmentId() != null
              && schema.applicantIds().contains(applicant.getDepartmentId());
      case "ROLES" ->
          applicant.getRoles().stream()
              .anyMatch(r -> r.isEnabled() && schema.applicantIds().contains(r.getId()));
      default -> false;
    };
  }

  /** 客户端模拟模型始终使用最新严格契约，不能借人员解析绕过发布及字段引用校验。 */
  public Map<String, List<Long>> resolve(Spec schema, SysUser applicant) {
    WorkflowSchema.validate(schema);
    return resolvePeople(schema, applicant);
  }

  /**
   * 正式提交与退回重提从已存实例读取冻结模型，调用方只能提供实例 ID，不能提交任意 schema 或选择宽松验证。实例快照在创建时复制不可变发布版本，编辑申请接口不接受
   * 模型字段；旧快照只保留旧单选比较语义，其他模型约束及当前人员权限仍重新校验。
   */
  public Map<String, List<Long>> resolveStoredSnapshot(Long requestId, SysUser applicant) {
    var request = requests.findById(requestId).orElseThrow(() -> new BusinessException("申请快照不存在"));
    if (!Objects.equals(request.getApplicantId(), applicant.getId()))
      throw new AccessDeniedException("只能解析本人申请的冻结快照");
    Spec schema =
        request.getSchemaSnapshot() == null
            ? legacy(request.getApproverIds())
            : json.spec(request.getSchemaSnapshot());
    WorkflowSchema.validateRuntimeSnapshot(schema);
    return resolvePeople(schema, applicant, json.assignees(request.getAssignmentOverrides()));
  }

  /** 所有节点人员在提交时冻结；角色和负责人后续变动不替换已有申请，但每次处理仍检查账号权限。 */
  private Map<String, List<Long>> resolvePeople(Spec schema, SysUser applicant) {
    return resolvePeople(schema, applicant, Map.of());
  }

  /** 只有服务端交接接口能写实例覆盖；重提重新校验接收人和人员规则，覆盖不改变节点字段或动作。 */
  private Map<String, List<Long>> resolvePeople(
      Spec schema, SysUser applicant, Map<String, List<Long>> overrides) {
    if (!canStart(schema, applicant)) throw new AccessDeniedException("当前账号不在流程发起范围");
    Map<String, List<Long>> result = new LinkedHashMap<>();
    for (Node node : schema.nodes())
      if (Set.of("APPROVAL", "COPY").contains(node.type())) {
        boolean approval = "APPROVAL".equals(node.type());
        List<SysUser> candidates;
        if (approval && overrides.containsKey(node.id()))
          candidates = overrides.get(node.id()).stream().map(id -> validUser(id, true)).toList();
        else if ("USERS".equals(node.source()))
          candidates = node.assigneeIds().stream().map(id -> validUser(id, approval)).toList();
        else if ("DEPARTMENT_LEADER".equals(node.source())) {
          var department =
              Optional.ofNullable(applicant.getDepartmentId())
                  .flatMap(entries::findById)
                  .filter(SystemEntry::isEnabled)
                  .orElseThrow(() -> new BusinessException("发起人没有有效所属部门"));
          if (department.getLeaderId() == null) throw new BusinessException("所属部门尚未设置负责人");
          candidates = List.of(validUser(department.getLeaderId(), approval));
        } else {
          node.assigneeIds().forEach(this::validRole);
          candidates =
              users
                  .findAll(
                      (r, q, c) -> {
                        q.distinct(true);
                        return r.join("roles").get("id").in(node.assigneeIds());
                      })
                  .stream()
                  .filter(
                      user ->
                          user.isEnabled()
                              && access.hasFor(
                                  user, approval ? "requests:approve" : "requests:view"))
                  .toList();
        }
        if (candidates.isEmpty() || candidates.size() > 100)
          throw new BusinessException(node.name() + "没有有效审批人或超过 100 人");
        // 指定人员顺序决定顺签顺序；角色成员没有人工顺序，按稳定账号编号排序。
        List<Long> ids =
            overrides.containsKey(node.id()) || "USERS".equals(node.source())
                ? candidates.stream().map(SysUser::getId).distinct().toList()
                : candidates.stream().map(SysUser::getId).distinct().sorted().toList();
        if (approval
            && !Boolean.TRUE.equals(schema.allowSelfApproval())
            && ids.contains(applicant.getId()))
          throw new BusinessException(node.name() + "包含申请人，流程不允许自我审批");
        result.put(node.id(), ids);
      }
    if (!Boolean.TRUE.equals(schema.allowRepeatApproval())) {
      var approvals = schema.nodes().stream().filter(n -> "APPROVAL".equals(n.type())).toList();
      for (var first : approvals)
        for (var second : approvals) {
          if (!first.id().equals(second.id())
              && reachable(schema, first, second.id(), new HashSet<>())
              && result.get(first.id()).stream().anyMatch(result.get(second.id())::contains))
            throw new BusinessException("同一路径的多个审批节点包含同一审批人，流程不允许重复审批人");
        }
    }
    return result;
  }

  /** 互斥分支可由同一人员负责，只有实际可能串行经过的节点才触发重复人员限制。 */
  private boolean reachable(Spec spec, Node node, String target, Set<String> visited) {
    if (!visited.add(node.id()) || "END".equals(node.type())) return false;
    List<String> exits = new ArrayList<>();
    exits.add(node.next());
    node.conditions().forEach(condition -> exits.add(condition.next()));
    return exits.stream()
        .anyMatch(id -> target.equals(id) || reachable(spec, spec.node(id), target, visited));
  }

  /** 人员替换只对可共同经过的审批节点限制重复；互斥分支的相同人员不会误判。 */
  public boolean shareApprovalPath(Spec spec, String first, String second) {
    return first.equals(second)
        || reachable(spec, spec.node(first), second, new HashSet<>())
        || reachable(spec, spec.node(second), first, new HashSet<>());
  }

  /** 申请入口只返回已发布版本的表单，避免使用未发布的设计草稿作为提交契约。 */
  public Map<String, Object> option(FlowDefinition definition) {
    var version = versions.findById(definition.getPublishedVersionId()).orElseThrow();
    var schema = json.spec(version.getSchemaJson());
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", definition.getId());
    out.put("name", definition.getName());
    out.put("businessType", definition.getBusinessType());
    out.put("categoryId", definition.getCategoryId());
    out.put("versionId", version.getId());
    out.put("versionNumber", version.getVersionNumber());
    out.put("fields", schema.fields());
    return out;
  }

  /** 只列出启用、已发布并允许当前账号发起的流程；内容审核可进一步按业务类型限定。 */
  public List<Map<String, Object>> options(String type) {
    access.require("requests:create");
    return definitions.findAll().stream()
        .filter(
            definition ->
                definition.isEnabled()
                    && definition.getPublishedVersionId() != null
                    && (type == null || type.equals(definition.getBusinessType())))
        .filter(
            definition ->
                canStart(
                    json.spec(
                        versions
                            .findById(definition.getPublishedVersionId())
                            .orElseThrow()
                            .getSchemaJson()),
                    access.current()))
        .map(this::option)
        .toList();
  }

  /** 已发布定义或历史申请引用只能停用，不能删掉审批实例依赖的定义及版本。 */
  @Transactional
  public void delete(Long id) {
    access.require("workflows:delete");
    var definition = find(id, true);
    if (requests.existsByDefinitionId(id) || definition.getPublishedVersionId() != null)
      throw new BusinessException("已发布或已被申请引用的流程不能删除，请停用");
    definitions.delete(definition);
  }

  /** 兼容旧顺序模板，默认禁止自审，正文作为一个稳定字段导入。 */
  public static Spec legacy(List<Long> ids) {
    List<Node> nodes = new ArrayList<>();
    for (int i = 0; i < ids.size(); i++)
      nodes.add(
          new Node(
              "step" + i,
              "审批 " + (i + 1),
              "APPROVAL",
              i + 1 < ids.size() ? "step" + (i + 1) : "end",
              "USERS",
              List.of(ids.get(i)),
              "ANY",
              Set.of("content"),
              Set.of(),
              Set.of("APPROVE", "REJECT", "COMMENT"),
              List.of()));
    nodes.add(
        new Node(
            "end", "结束", "END", null, null, List.of(), null, Set.of(), Set.of(), Set.of(),
            List.of()));
    return new Spec(
        List.of(new Field("content", "申请说明", "TEXTAREA", true, 24, null, null, 10000, List.of())),
        nodes,
        ids.isEmpty() ? "end" : "step0",
        "ALL",
        Set.of(),
        false,
        false,
        true);
  }
}
