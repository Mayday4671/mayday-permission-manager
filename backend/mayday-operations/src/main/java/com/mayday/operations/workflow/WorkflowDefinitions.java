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
import java.util.*;
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

  public record Draft(
      @NotBlank @Size(max = 100) String name,
      @NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{2,64}") String code,
      @Size(max = 500) String description,
      @NotNull Long categoryId,
      @NotNull @Pattern(regexp = "GENERAL|CONTENT") String businessType,
      @NotNull Boolean enabled,
      Spec schema,
      Long version) {}

  public FlowDefinition find(Long id, boolean lock) {
    return (lock ? definitions.lockById(id) : definitions.findById(id))
        .orElseThrow(() -> new BusinessException("流程定义不存在"));
  }

  public Map<String, Object> view(FlowDefinition d) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", d.getId());
    out.put("version", d.getVersion());
    out.put("createdAt", d.getCreatedAt());
    out.put("updatedAt", d.getUpdatedAt());
    out.put("name", d.getName());
    out.put("code", d.getCode());
    out.put("description", d.getDescription());
    out.put("enabled", d.isEnabled());
    out.put("categoryId", d.getCategoryId());
    out.put(
        "category",
        d.getCategoryId() == null
            ? "未分类"
            : entries.findById(d.getCategoryId()).map(SystemEntry::getName).orElse("未分类"));
    out.put("businessType", d.getBusinessType());
    out.put("publishedVersionId", d.getPublishedVersionId());
    out.put(
        "publishedVersion",
        d.getPublishedVersionId() == null
            ? null
            : versions
                .findById(d.getPublishedVersionId())
                .map(FlowVersion::getVersionNumber)
                .orElse(null));
    var schema =
        d.getDraftSchema() == null ? legacy(d.getApproverIds()) : json.spec(d.getDraftSchema());
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
                u -> Map.of("value", u.getId(), "label", u.getNickname() + " · " + u.getUsername()))
            .toList());
    return out;
  }

  @Transactional
  public Map<String, Object> save(Long id, Draft input) {
    access.require(id == null ? "workflows:create" : "workflows:update");
    access.require("workflows:view");
    var d = id == null ? new FlowDefinition() : find(id, true);
    if (id != null) OperationSupport.version(d, input.version());
    entries
        .findById(input.categoryId())
        .filter(e -> e.getKind().equals("approvalcategories") && e.isEnabled())
        .orElseThrow(() -> new BusinessException("请选择有效的审批分类"));
    if (d.getPublishedVersionId() != null && !d.getBusinessType().equals(input.businessType()))
      throw new BusinessException("已发布流程不能更换业务类型，请新建流程");
    String schema =
        json.write(
            input.schema() == null
                ? new Spec(List.of(), List.of(), "", "ALL", Set.of(), false, false, true)
                : input.schema());
    if (schema.length() > 100000) throw new BusinessException("流程模型超过最大长度");
    d.setName(input.name().trim());
    d.setCode(input.code());
    d.setDescription(input.description());
    d.setCategoryId(input.categoryId());
    d.setBusinessType(input.businessType());
    d.setEnabled(input.enabled());
    d.setDraftSchema(schema);
    definitions.saveAndFlush(d);
    return view(d);
  }

  @Transactional
  public Map<String, Object> publish(Long id, Long version) {
    access.require("workflows:view");
    access.require("workflows:publish");
    var d = find(id, true);
    OperationSupport.version(d, version);
    var schema =
        d.getDraftSchema() == null ? legacy(d.getApproverIds()) : json.spec(d.getDraftSchema());
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
    d.setPublishedVersionId(published.getId());
    d.setDraftSchema(published.getSchemaJson());
    definitions.flush();
    return view(d);
  }

  public void validateReferences(Spec schema) {
    WorkflowSchema.validate(schema);
    if ("USERS".equals(schema.applicantType()))
      for (Long id : schema.applicantIds()) validUser(id, false);
    if ("ROLES".equals(schema.applicantType())) for (Long id : schema.applicantIds()) validRole(id);
    if ("DEPARTMENTS".equals(schema.applicantType()))
      for (Long id : schema.applicantIds()) validDepartment(id);
    for (Node n : schema.nodes())
      if ("APPROVAL".equals(n.type())) {
        if ("USERS".equals(n.source())) for (Long id : n.assigneeIds()) validUser(id, true);
        if ("ROLES".equals(n.source())) for (Long id : n.assigneeIds()) validRole(id);
      }
  }

  private SysUser validUser(Long id, boolean approver) {
    var u =
        users
            .findById(id)
            .filter(SysUser::isEnabled)
            .orElseThrow(() -> new BusinessException("流程引用了不存在或停用的账号"));
    if (approver && !access.hasFor(u, "requests:approve"))
      throw new BusinessException("指定审批人缺少审批权限");
    return u;
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

  public boolean canStart(Spec s, SysUser applicant) {
    return switch (s.applicantType()) {
      case "ALL" -> true;
      case "USERS" -> s.applicantIds().contains(applicant.getId());
      case "DEPARTMENTS" ->
          applicant.getDepartmentId() != null
              && s.applicantIds().contains(applicant.getDepartmentId());
      case "ROLES" ->
          applicant.getRoles().stream()
              .anyMatch(r -> r.isEnabled() && s.applicantIds().contains(r.getId()));
      default -> false;
    };
  }

  /** 所有节点人员在提交时冻结；角色和负责人后续变动不替换已有申请，但每次处理仍检查账号权限。 */
  public Map<String, List<Long>> resolve(Spec schema, SysUser applicant) {
    WorkflowSchema.validate(schema);
    if (!canStart(schema, applicant)) throw new AccessDeniedException("当前账号不在流程发起范围");
    Map<String, List<Long>> result = new LinkedHashMap<>();
    Set<Long> used = new HashSet<>();
    for (Node n : schema.nodes())
      if ("APPROVAL".equals(n.type())) {
        List<SysUser> candidates;
        if ("USERS".equals(n.source()))
          candidates = n.assigneeIds().stream().map(id -> validUser(id, true)).toList();
        else if ("DEPARTMENT_LEADER".equals(n.source())) {
          var department =
              Optional.ofNullable(applicant.getDepartmentId())
                  .flatMap(entries::findById)
                  .filter(SystemEntry::isEnabled)
                  .orElseThrow(() -> new BusinessException("发起人没有有效所属部门"));
          if (department.getLeaderId() == null) throw new BusinessException("所属部门尚未设置负责人");
          candidates = List.of(validUser(department.getLeaderId(), true));
        } else {
          n.assigneeIds().forEach(this::validRole);
          candidates =
              users
                  .findAll(
                      (r, q, c) -> {
                        q.distinct(true);
                        return r.join("roles").get("id").in(n.assigneeIds());
                      })
                  .stream()
                  .filter(u -> u.isEnabled() && access.hasFor(u, "requests:approve"))
                  .toList();
        }
        if (candidates.isEmpty() || candidates.size() > 100)
          throw new BusinessException(n.name() + "没有有效审批人或超过 100 人");
        List<Long> ids = candidates.stream().map(SysUser::getId).distinct().sorted().toList();
        if (!Boolean.TRUE.equals(schema.allowSelfApproval()) && ids.contains(applicant.getId()))
          throw new BusinessException(n.name() + "包含申请人，流程不允许自我审批");
        if (!Boolean.TRUE.equals(schema.allowRepeatApproval())
            && ids.stream().anyMatch(used::contains))
          throw new BusinessException("多个审批节点包含同一审批人，流程不允许重复审批人");
        used.addAll(ids);
        result.put(n.id(), ids);
      }
    return result;
  }

  public Map<String, Object> option(FlowDefinition d) {
    var version = versions.findById(d.getPublishedVersionId()).orElseThrow();
    var schema = json.spec(version.getSchemaJson());
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", d.getId());
    out.put("name", d.getName());
    out.put("businessType", d.getBusinessType());
    out.put("categoryId", d.getCategoryId());
    out.put("versionId", version.getId());
    out.put("versionNumber", version.getVersionNumber());
    out.put("fields", schema.fields());
    return out;
  }

  public List<Map<String, Object>> options(String type) {
    access.require("requests:create");
    return definitions.findAll().stream()
        .filter(
            d ->
                d.isEnabled()
                    && d.getPublishedVersionId() != null
                    && (type == null || type.equals(d.getBusinessType())))
        .filter(
            d ->
                canStart(
                    json.spec(
                        versions.findById(d.getPublishedVersionId()).orElseThrow().getSchemaJson()),
                    access.current()))
        .map(this::option)
        .toList();
  }

  @Transactional
  public void delete(Long id) {
    access.require("workflows:delete");
    var d = find(id, true);
    if (requests.existsByDefinitionId(id) || d.getPublishedVersionId() != null)
      throw new BusinessException("已发布或已被申请引用的流程不能删除，请停用");
    definitions.delete(d);
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
