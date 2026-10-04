package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.operations.workflow.WorkflowDelegations;
import com.mayday.operations.workflow.WorkflowEngine;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 委托与人员交接使用单独权限接口；不伪装成审批决定，也不修改发布版本。 */
@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
public class WorkflowContinuityController {
  private final WorkflowDelegations delegations;
  private final WorkflowEngine engine;

  /** 本人创建或收到的委托记录，按有效期展示且始终保留撤销历史。 */
  @GetMapping("/delegations")
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "mine") String box,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(delegations.list(box, page, size));
  }

  /** 委托范围目录独立于完整模型读取，普通审批人无需取得流程设计权限。 */
  @GetMapping("/delegations/scopes")
  public ApiResponse<?> scopes() {
    return ApiResponse.ok(delegations.scopeOptions());
  }

  /** 设置仅影响以后激活的任务；已激活任务保持明确的原归属。 */
  @PostMapping("/delegations")
  public ApiResponse<?> create(@Valid @RequestBody WorkflowDelegations.Create body) {
    return ApiResponse.ok(delegations.create(body));
  }

  /** 撤销校验创建人和当前版本，不能用他人的编号取消委托。 */
  @PostMapping("/delegations/{id}/revoke")
  public ApiResponse<?> revoke(
      @PathVariable Long id, @Valid @RequestBody WorkflowController.Version body) {
    return ApiResponse.ok(delegations.revoke(id, body.version()));
  }

  /** 管理员修复当前任务和冻结的后续人员，保留已办理轨迹并向新处理人投递通知。 */
  @PostMapping("/requests/{id}/handover")
  public ApiResponse<?> handover(
      @PathVariable Long id, @Valid @RequestBody WorkflowEngine.Handover body) {
    return ApiResponse.ok(engine.handover(id, body));
  }
}
