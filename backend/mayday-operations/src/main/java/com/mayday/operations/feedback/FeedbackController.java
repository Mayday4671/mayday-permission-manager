package com.mayday.operations.feedback;

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 后台反馈入口；候选处理人只公开有处理权限账号的ID/姓名，不借此暴露联系方式或全站资料。 */
@RestController
@RequestMapping("/api/operations/feedback")
@RequiredArgsConstructor
public class FeedbackController {
  private final FeedbackService service;
  private final AccessPolicy access;
  private final UserRepository users;

  /** 分配候选只包含账号ID和显示名，不暴露联系方式、角色详情或登录凭据。 */
  @Schema(
      name = "FeedbackAssignee",
      requiredProperties = {"value", "label"})
  public record Assignee(Long value, String label) {}

  /** 后台按条件分页读取反馈；服务层独立执行查看权限，不依赖菜单隐藏。 */
  @GetMapping
  public ApiResponse<PageResult<FeedbackService.AdminView>> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    return ApiResponse.ok(service.list(keyword, status, page, size));
  }

  /** 读取后台反馈详情和完整内部处理历史；仅已授权人员可调用。 */
  @GetMapping("/{id}")
  public ApiResponse<FeedbackService.AdminView> detail(@PathVariable Long id) {
    return ApiResponse.ok(service.detail(id));
  }

  /** 提交带版本的处理动作，公开回复与内部备注使用分离字段；冲突时整次操作回滚。 */
  @PostMapping("/{id}/process")
  public ApiResponse<FeedbackService.AdminView> process(
      @PathVariable Long id, @Valid @RequestBody FeedbackService.Process request) {
    return ApiResponse.ok(service.process(id, request));
  }

  /** 分配权限下最多返回100个搜索候选，再校验反馈查看/处理权限，防止无效负责人接受任务。 */
  @GetMapping("/assignees")
  @Transactional(readOnly = true)
  public ApiResponse<List<Assignee>> assignees(@RequestParam(defaultValue = "") String keyword) {
    access.require("feedback:view");
    access.require("feedback:assign");
    return ApiResponse.ok(
        users
            .findAll(
                (root, query, criteria) ->
                    criteria.and(
                        criteria.isTrue(root.get("enabled")),
                        com.mayday.common.SearchPredicates.contains(
                            criteria, root.get("nickname"), keyword)),
                PageResult.request(1, 100))
            .stream()
            .filter(
                user ->
                    access.hasFor(user, "feedback:process") && access.hasFor(user, "feedback:view"))
            .map(user -> new Assignee(user.getId(), user.getNickname()))
            .toList());
  }
}
