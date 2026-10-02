package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.service.ChangeAuditService.Difference;
import com.mayday.system.model.ChangeAudit;
import com.mayday.system.repository.ChangeAuditRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** 关键变更与 HTTP 请求日志分开展示，均复用操作日志查看权限，不允许匿名或普通消息用户读取。 */
@RestController
@RequestMapping("/api/system/changes")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ChangeAuditController {
  private final ChangeAuditRepository repository;
  private final AccessPolicy access;
  private final ObjectMapper mapper;

  /** 业务变更的白名单差异响应，仅含可读字段前后值；不返回密码、令牌、联系方式或整份原始请求。 */
  @Schema(
      name = "ChangeAuditView",
      requiredProperties = {"id", "version", "actor", "resource", "action", "createdAt", "changes"})
  public record View(
      Long id,
      Long version,
      String actor,
      String resource,
      Long resourceId,
      String action,
      LocalDateTime createdAt,
      List<Difference> changes) {}

  /** 列表采用服务端分页，字段内容在脱敏审计服务中已收紧。 */
  @GetMapping
  public ApiResponse<PageResult<View>> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("logs:view");
    return ApiResponse.ok(
        PageResult.from(
            repository
                .findAll(
                    (root, query, criteria) ->
                        criteria.or(
                            SearchPredicates.contains(criteria, root.get("actor"), keyword),
                            SearchPredicates.contains(criteria, root.get("action"), keyword),
                            SearchPredicates.contains(criteria, root.get("resource"), keyword)),
                    PageResult.request(page, size))
                .map(this::view)));
  }

  /** 详情重新鉴权和读取，不能借旧列表缓存绕过撤销权限。 */
  @GetMapping("/{id}")
  public ApiResponse<View> detail(@PathVariable Long id) {
    access.require("logs:view");
    return ApiResponse.ok(
        view(repository.findById(id).orElseThrow(() -> new BusinessException("变更记录不存在"))));
  }

  private View view(ChangeAudit audit) {
    return new View(
        audit.getId(),
        audit.getVersion(),
        audit.getActor(),
        audit.getResource(),
        audit.getResourceId(),
        audit.getAction(),
        audit.getCreatedAt(),
        mapper.readValue(audit.getChangesJson(), new TypeReference<List<Difference>>() {}));
  }
}
