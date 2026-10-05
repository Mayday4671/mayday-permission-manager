package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.repository.BusinessEventRepository;
import com.mayday.operations.repository.FlowDefinitionRepository;
import com.mayday.operations.repository.FlowRequestRepository;
import com.mayday.operations.repository.FlowVersionRepository;
import com.mayday.operations.workflow.WorkflowDefinitions;
import com.mayday.operations.workflow.WorkflowEngine;
import com.mayday.operations.workflow.WorkflowFormValuesDeserializer;
import com.mayday.operations.workflow.WorkflowJson;
import com.mayday.operations.workflow.WorkflowSchema;
import com.mayday.operations.workflow.WorkflowSimulation;
import com.mayday.operations.workflow.WorkflowSubprocessRepair;
import com.mayday.operations.workflow.WorkflowTemplates;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 审批接口只处理参数、分页与响应；状态和权限规则由定义服务和运行引擎统一执行。 */
@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WorkflowController {
  private final FlowDefinitionRepository definitions;
  private final FlowVersionRepository versions;
  private final FlowRequestRepository requests;
  private final WorkflowDefinitions models;
  private final WorkflowEngine engine;
  private final AccessPolicy access;
  private final UserRepository users;
  private final WorkflowJson json;
  private final WorkflowSimulation simulation;
  private final BusinessEventRepository events;
  private final com.mayday.system.repository.RoleRepository roles;

  /** 发布或催办携带乐观版本，过期页面不能改变当前流程/申请状态。 */
  @Schema(name = "WorkflowVersionRequest")
  public record Version(@NotNull Long version) {}

  /** 失败恢复必须携带当前申请版本和人工说明，保留管理员修复审计。 */
  public record Recovery(
      @NotNull Long version,
      @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max = 300)
          String reason) {}

  /** 模拟参数只用于校验与路径展示，不生成申请、待办或通知事件。 */
  public record Simulation(
      @NotNull WorkflowSchema.Spec schema,
      Long applicantId,
      @tools.jackson.databind.annotation.JsonDeserialize(
              using = WorkflowFormValuesDeserializer.class)
          Map<String, Object> values) {}

  /** 模板没有持久化状态，用户选择后通过正常新建流程接口保存为自己的草稿。 */
  @GetMapping("/workflows/templates")
  public ApiResponse<List<WorkflowTemplates.Template>> templates() {
    access.require("workflows:view");
    return ApiResponse.ok(WorkflowTemplates.all());
  }

  /** 发起入口按已发布、启用、业务类型和当前账号发起范围返回可选流程。 */
  @GetMapping("/workflows/options")
  public ApiResponse<?> options(@RequestParam(required = false) String businessType) {
    return ApiResponse.ok(models.options(businessType));
  }

  /** 设计器人员来源只提供有效角色目录；发布时仍重新核验解析后的账号和审批权限。 */
  @GetMapping("/workflows/roles")
  public ApiResponse<?> roleOptions() {
    access.require("workflows:view");
    return ApiResponse.ok(
        roles.findAll().stream()
            .filter(com.mayday.system.model.SysRole::isEnabled)
            .map(r -> Map.of("value", r.getId(), "label", r.getName()))
            .toList());
  }

  /** 子流程选择只返回已发布通用定义及当前版本表单；选定后另读不可变版本，不使用定义 ID 执行。 */
  @GetMapping("/workflows/subprocess-options")
  public ApiResponse<?> subprocessOptions(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("workflows:view");
    return ApiResponse.ok(
        PageResult.from(
            definitions
                .findAll(
                    (r, q, c) ->
                        c.and(
                            SearchPredicates.contains(c, r.get("name"), keyword),
                            c.isTrue(r.get("enabled")),
                            c.equal(r.get("businessType"), "GENERAL"),
                            c.isNotNull(r.get("publishedVersionId"))),
                    PageResult.request(page, size))
                .map(models::option)));
  }

  /** 编辑已绑定旧版本时读取其确切表单，不把下拉框中的最新发布版回填覆盖原绑定。 */
  @GetMapping("/workflows/subprocess-versions/{versionId}")
  public ApiResponse<?> subprocessVersion(@PathVariable Long versionId) {
    access.require("workflows:view");
    var version = models.subprocessVersion(versionId);
    var definition = models.find(version.getDefinitionId(), false);
    return ApiResponse.ok(
        Map.of(
            "definitionId",
            definition.getId(),
            "name",
            definition.getName(),
            "versionId",
            version.getId(),
            "versionNumber",
            version.getVersionNumber(),
            "fields",
            json.spec(version.getSchemaJson()).fields()));
  }

  /** 流程管理按分类与启用状态分页，草稿不会替代新申请使用的发布版本。 */
  @GetMapping("/workflows")
  public ApiResponse<?> definitions(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(required = false) Long categoryId,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("workflows:view");
    return ApiResponse.ok(
        PageResult.from(
            definitions
                .findAll(
                    (r, q, c) ->
                        c.and(
                            SearchPredicates.contains(c, r.get("name"), keyword),
                            enabled == null ? c.conjunction() : c.equal(r.get("enabled"), enabled),
                            categoryId == null
                                ? c.conjunction()
                                : c.equal(r.get("categoryId"), categoryId)),
                    PageResult.request(page, size))
                .map(models::view)));
  }

  /** 设计器读取当前草稿及可见人员标签，不把流程查看权等同于全量用户查看权。 */
  @GetMapping("/workflows/{id}")
  public ApiResponse<?> detail(@PathVariable Long id) {
    access.require("workflows:view");
    return ApiResponse.ok(models.view(models.find(id, false)));
  }

  /** 只列出该定义的不可变发布历史，新版本发布不会重写已有实例。 */
  @GetMapping("/workflows/{id}/versions")
  public ApiResponse<?> versions(@PathVariable Long id) {
    access.require("workflows:view");
    models.find(id, false);
    return ApiResponse.ok(
        versions.findByDefinitionIdOrderByVersionNumberDesc(id).stream()
            .map(
                v ->
                    Map.of(
                        "id",
                        v.getId(),
                        "versionNumber",
                        v.getVersionNumber(),
                        "publishedAt",
                        v.getCreatedAt(),
                        "publisherName",
                        v.getPublisherName(),
                        "schema",
                        json.spec(v.getSchemaJson())))
            .toList());
  }

  /** 保存新定义草稿，不自动发布；未完成节点可稍后在设计器补齐。 */
  @PostMapping("/workflows")
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody WorkflowDefinitions.Draft body) {
    return ApiResponse.ok(models.save(null, body));
  }

  /** 编辑定义必须携带旧版本，保护并发编辑和已经发布的业务类型。 */
  @PutMapping("/workflows/{id}")
  @Transactional
  public ApiResponse<?> update(
      @PathVariable Long id, @Valid @RequestBody WorkflowDefinitions.Draft body) {
    return ApiResponse.ok(models.save(id, body));
  }

  /** 发布前完整校验节点图、字段、人员和权限，成功时只追加新版本。 */
  @PostMapping("/workflows/{id}/publish")
  @Transactional
  public ApiResponse<?> publish(@PathVariable Long id, @Valid @RequestBody Version body) {
    return ApiResponse.ok(models.publish(id, body.version()));
  }

  /** 已有发布或申请引用的定义拒绝删除，应通过停用阻止后续提交。 */
  @DeleteMapping("/workflows/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    models.delete(id);
    return ApiResponse.ok(null);
  }

  /** 模拟只解析人员、表单与分支路径，不保存申请、任务或通知。 */
  @PostMapping("/workflows/simulate")
  public ApiResponse<?> simulate(@Valid @RequestBody Simulation body) {
    access.require("workflows:view");
    access.require("users:view");
    models.validateReferences(body.schema());
    var applicant = access.current();
    if (body.applicantId() != null && !body.applicantId().equals(applicant.getId())) {
      access.require("users:view");
      applicant =
          users.findById(body.applicantId()).orElseThrow(() -> new BusinessException("模拟发起人不存在"));
      access.checkData("users", applicant.getId(), applicant.getDepartmentId());
    }
    var people = models.resolve(body.schema(), applicant);
    // 模拟模型来自客户端：USERS、ROLES、部门负责人三种来源解析后都要核对范围。
    // 不能仅校验发起人，也不能静默省略无权查看的审批人，造成路径预览与实际运行结果不同。
    for (var user :
        users.findAllById(people.values().stream().flatMap(Collection::stream).distinct().toList()))
      access.checkData("users", user.getId(), user.getDepartmentId());
    var values = WorkflowSchema.form(body.schema(), body.values());
    return ApiResponse.ok(
        Map.of("valid", true, "path", simulation.path(body.schema(), values, applicant)));
  }

  /** 申请分页在数据库按本人、待办、已办或独立全量管理范围过滤。 */
  @GetMapping("/requests")
  public ApiResponse<?> requests(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "mine") String box,
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    if (status != null
        && !java.util.Set.of(
                "DRAFT", "PENDING", "RETURNED", "APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED")
            .contains(status)) throw new BusinessException("未知申请状态");
    return ApiResponse.ok(
        PageResult.from(
            requests
                .findAll(
                    engine
                        .filter(keyword, box)
                        .and(
                            (r, q, c) ->
                                status == null
                                    ? c.conjunction()
                                    : c.equal(r.get("status"), status)),
                    PageResult.request(page, size))
                .map(engine::summary)));
  }

  /** 详情按当前参与范围与节点可读字段返回，未来节点人员不能提前读取申请。 */
  @GetMapping("/requests/{id}")
  public ApiResponse<?> request(
      @PathVariable Long id, @RequestParam(required = false) Long taskId) {
    return ApiResponse.ok(engine.detail(id, taskId));
  }

  /** 处理历史复用详情字段范围，不能借修改前后值绕过当前字段读取授权。 */
  @GetMapping("/requests/{id}/history")
  public ApiResponse<?> history(@PathVariable Long id) {
    return ApiResponse.ok(engine.detail(id).get("history"));
  }

  /** 提交绑定当前发布版本，冻结运行模型和人员快照，业务回调失败时整项回滚。 */
  @PostMapping("/requests")
  @Transactional
  public ApiResponse<?> submit(@Valid @RequestBody WorkflowEngine.Submit body) {
    return ApiResponse.ok(engine.submit(body));
  }

  /** 申请草稿只对本人可见；必填字段可暂缺，类型、附件所有权和发布版本仍检查。 */
  @PostMapping("/requests/drafts")
  @Transactional
  public ApiResponse<?> draft(@Valid @RequestBody WorkflowEngine.Submit body) {
    return ApiResponse.ok(engine.draft(body));
  }

  /** 仅原申请人可保存草稿、退回或撤回后的修改，不能变更实例所属流程与业务修订。 */
  @PutMapping("/requests/{id}")
  @Transactional
  public ApiResponse<?> edit(@PathVariable Long id, @Valid @RequestBody WorkflowEngine.Edit body) {
    return ApiResponse.ok(engine.edit(id, body, false));
  }

  /** 重提沿用原发布模型并重新解析有效人员；旧待办不能作为新轮次的通过凭证。 */
  @PostMapping("/requests/{id}/submit")
  @Transactional
  public ApiResponse<?> resubmit(
      @PathVariable Long id, @Valid @RequestBody WorkflowEngine.Edit body) {
    return ApiResponse.ok(engine.edit(id, body, true));
  }

  /** 只删除本人未提交草稿，正式申请保留审计轨迹且不能物理删除。 */
  @DeleteMapping("/requests/{id}")
  @Transactional
  public ApiResponse<Void> discardDraft(@PathVariable Long id, @RequestParam Long version) {
    engine.discardDraft(id, version);
    return ApiResponse.ok(null);
  }

  /** 只修改当前接收者自己的抄送阅读状态，查看权限不能代替审批权限。 */
  @PostMapping("/requests/{id}/copies/read")
  @Transactional
  public ApiResponse<Void> readCopies(@PathVariable Long id) {
    engine.readCopies(id);
    return ApiResponse.ok(null);
  }

  /** 决定在申请行锁内核验版本、当前处理人、节点动作和可写字段，不能代替其他人处理。 */
  @PostMapping("/requests/{id}/decision")
  @Transactional
  public ApiResponse<?> decide(
      @PathVariable Long id, @Valid @RequestBody WorkflowEngine.Action body) {
    return ApiResponse.ok(engine.act(id, body));
  }

  /** 恢复重试原固定节点，不允许客户端选择新流程版本或注入执行游标。 */
  @PostMapping("/requests/{id}/recover")
  @Transactional
  public ApiResponse<?> recover(@PathVariable Long id, @Valid @RequestBody Recovery body) {
    return ApiResponse.ok(engine.recover(id, body.version(), body.reason()));
  }

  /** 目录只包含此申请的待启动失败调用；无修复权限或原来源超出数据范围时拒绝读取。 */
  @GetMapping("/requests/{id}/subprocess-repair-options")
  public ApiResponse<?> subprocessRepairOptions(@PathVariable Long id) {
    return ApiResponse.ok(engine.subprocessRepairOptions(id));
  }

  /** 独立实例人员修复沿用绑定的发布版本；保存后须显式恢复，不重新启用离职账号。 */
  @PostMapping("/requests/{id}/subprocess-repair")
  @Transactional
  public ApiResponse<?> repairSubprocess(
      @PathVariable Long id, @Valid @RequestBody WorkflowSubprocessRepair.Repair body) {
    return ApiResponse.ok(engine.repairSubprocess(id, body));
  }

  /** 催办是单独权限动作，不会隐式授予审批或修改申请字段的权限。 */
  @PostMapping("/requests/{id}/remind")
  @Transactional
  public ApiResponse<Void> remind(@PathVariable Long id, @Valid @RequestBody Version body) {
    engine.remind(id, body.version());
    return ApiResponse.ok(null);
  }

  /** 审批管理员可检查该申请持久消息事件的投递与重试状态，不返回业务正文。 */
  @GetMapping("/requests/{id}/events")
  public ApiResponse<?> events(@PathVariable Long id) {
    access.require("requests:manage");
    engine.accessible(id, false);
    return ApiResponse.ok(
        events.findByRequestIdOrderByIdDesc(id).stream()
            .map(
                e -> {
                  Map<String, Object> result = new LinkedHashMap<>();
                  result.put("id", e.getId());
                  result.put("status", e.getStatus());
                  result.put("attempts", e.getAttempts());
                  result.put("lastError", e.getLastError());
                  result.put("nextAttemptAt", e.getNextAttemptAt());
                  return result;
                })
            .toList());
  }

  /** 仅管理员能将仍待投递事件安排立即重试，已投递事件不会被改回待投递。 */
  @PostMapping("/requests/{id}/retry-notifications")
  @Transactional
  public ApiResponse<?> retry(@PathVariable Long id) {
    access.require("requests:manage");
    engine.accessible(id, false);
    events.findByRequestIdOrderByIdDesc(id).stream()
        .filter(e -> e.getStatus().equals("PENDING"))
        .forEach(e -> e.setNextAttemptAt(java.time.LocalDateTime.now()));
    return ApiResponse.ok(null);
  }
}
