package com.mayday.operations.web;

import com.mayday.common.*;
import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.operations.workflow.*;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

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
  private final BusinessEventRepository events;
  private final com.mayday.system.repository.RoleRepository roles;

  public record Version(@NotNull Long version) {}

  public record Simulation(
      @NotNull WorkflowSchema.Spec schema, Long applicantId, Map<String, Object> values) {}

  @GetMapping("/workflows/options")
  public ApiResponse<?> options(@RequestParam(required = false) String businessType) {
    return ApiResponse.ok(models.options(businessType));
  }

  @GetMapping("/workflows/roles")
  public ApiResponse<?> roleOptions() {
    access.require("workflows:view");
    return ApiResponse.ok(
        roles.findAll().stream()
            .filter(com.mayday.system.model.SysRole::isEnabled)
            .map(r -> Map.of("value", r.getId(), "label", r.getName()))
            .toList());
  }

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

  @GetMapping("/workflows/{id}")
  public ApiResponse<?> detail(@PathVariable Long id) {
    access.require("workflows:view");
    return ApiResponse.ok(models.view(models.find(id, false)));
  }

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

  @PostMapping("/workflows")
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody WorkflowDefinitions.Draft body) {
    return ApiResponse.ok(models.save(null, body));
  }

  @PutMapping("/workflows/{id}")
  @Transactional
  public ApiResponse<?> update(
      @PathVariable Long id, @Valid @RequestBody WorkflowDefinitions.Draft body) {
    return ApiResponse.ok(models.save(id, body));
  }

  @PostMapping("/workflows/{id}/publish")
  @Transactional
  public ApiResponse<?> publish(@PathVariable Long id, @Valid @RequestBody Version body) {
    return ApiResponse.ok(models.publish(id, body.version()));
  }

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
    List<Map<String, Object>> path = new ArrayList<>();
    String next = body.schema().startNodeId();
    for (int count = 0; count <= body.schema().nodes().size(); count++) {
      var node = body.schema().node(next);
      var row = new LinkedHashMap<String, Object>();
      row.put("id", node.id());
      row.put("name", node.name());
      row.put("type", node.type());
      row.put(
          "approvers",
          users.findAllById(people.getOrDefault(node.id(), List.of())).stream()
              .map(u -> Map.of("id", u.getId(), "name", u.getNickname()))
              .toList());
      path.add(row);
      if (node.type().equals("END")) break;
      next = WorkflowSchema.next(node, values);
    }
    return ApiResponse.ok(Map.of("valid", true, "path", path));
  }

  @GetMapping("/requests")
  public ApiResponse<?> requests(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "mine") String box,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(
        PageResult.from(
            requests
                .findAll(engine.filter(keyword, box), PageResult.request(page, size))
                .map(engine::summary)));
  }

  @GetMapping("/requests/{id}")
  public ApiResponse<?> request(@PathVariable Long id) {
    return ApiResponse.ok(engine.detail(id));
  }

  @GetMapping("/requests/{id}/history")
  public ApiResponse<?> history(@PathVariable Long id) {
    return ApiResponse.ok(engine.detail(id).get("history"));
  }

  @PostMapping("/requests")
  @Transactional
  public ApiResponse<?> submit(@Valid @RequestBody WorkflowEngine.Submit body) {
    return ApiResponse.ok(engine.submit(body));
  }

  @PostMapping("/requests/{id}/decision")
  @Transactional
  public ApiResponse<?> decide(
      @PathVariable Long id, @Valid @RequestBody WorkflowEngine.Action body) {
    return ApiResponse.ok(engine.act(id, body));
  }

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
