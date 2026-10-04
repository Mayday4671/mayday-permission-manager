package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.security.SessionPolicy;
import com.mayday.security.TokenService;
import com.mayday.system.model.LoginSession;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.SessionRepository;
import com.mayday.system.repository.UserRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 会话响应使用独立 UUID，绝不返回 token 或其摘要；管理员只能撤销自己有权管理的账号会话。 */
@RestController
@RequestMapping("/api/operations/sessions")
@RequiredArgsConstructor
public class SessionController {
  private final SessionRepository sessions;
  private final UserRepository users;
  private final AccessPolicy access;
  private final SessionPolicy policy;
  private final Clock sessionClock;

  /** 本人会话允许自助查看；其他账号必须落在实时用户数据范围内，不能由 sessions:view 隐式扩权。 */
  private boolean visible(SysUser user) {
    return Objects.equals(user.getId(), access.current().getId()) || access.canViewUser(user);
  }

  /** 有效期、账号状态、授权和关键词都在 SQL 计数与分页之前过滤；不会全量载入其他账号会话。 返回预计失效时间（无活动截止时间会随认证活动推进），绝不返回令牌或摘要。 */
  @GetMapping
  @Transactional(readOnly = true)
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size,
      @RequestHeader("Authorization") String auth) {
    access.require("sessions:view");
    String current = TokenService.hash(auth.substring(7));
    var now = sessionClock.instant();
    Specification<SysUser> userScope = access.filter("users", "id");
    Specification<LoginSession> scope =
        (root, query, builder) -> {
          var user = query.from(SysUser.class);
          var visible = builder.equal(user.get("id"), access.current().getId());
          if (access.has("users:view"))
            visible = builder.or(visible, userScope.toPredicate(user, query, builder));
          return builder.and(
              builder.equal(root.get("userId"), user.get("id")),
              builder.isTrue(user.get("enabled")),
              visible,
              builder.greaterThan(root.get("expiresAt"), now),
              builder.greaterThan(
                  root.get("createdAt"), now.minusSeconds(policy.getAbsoluteMinutes() * 60L)),
              builder.greaterThan(
                  builder.<Instant>coalesce(root.get("lastActiveAt"), root.get("createdAt")),
                  now.minusSeconds(policy.getIdleMinutes() * 60L)),
              builder.or(
                  SearchPredicates.contains(builder, user.get("username"), keyword),
                  SearchPredicates.contains(builder, user.get("nickname"), keyword)));
        };
    // UUID作为次级排序键，保证同一时刻多会话分页不重复或遗漏。
    var paging =
        PageRequest.of(
            Math.max(1, page) - 1,
            Math.max(1, Math.min(size, 100)),
            Sort.by(Sort.Direction.DESC, "createdAt", "sessionId"));
    var result =
        sessions
            .findAll(scope, paging)
            .map(
                s -> {
                  var u = users.findById(s.getUserId()).orElseThrow();
                  Map<String, Object> m = new LinkedHashMap<>();
                  m.put("id", s.getSessionId());
                  m.put("username", u.getUsername());
                  m.put("nickname", u.getNickname());
                  m.put("createdAt", s.getCreatedAt());
                  m.put("lastActiveAt", s.getLastActiveAt());
                  m.put("expiresAt", policy.effectiveExpiry(s));
                  m.put("ip", s.getIp());
                  m.put("device", s.getDevice());
                  m.put("current", current.equals(s.getTokenHash()));
                  return m;
                });
    return ApiResponse.ok(PageResult.from(result));
  }

  /** 撤销目标会话要求独立踢出权限及目标保护；撤销后认证与实时连接重新检查立即拒绝旧会话。 */
  @DeleteMapping("/{id}")
  @Transactional
  public ApiResponse<?> revoke(@PathVariable String id) {
    access.require("sessions:view");
    access.require("sessions:revoke");
    var s = sessions.findBySessionId(id).orElseThrow(() -> new BusinessException("会话已失效"));
    var user =
        users
            .findById(s.getUserId())
            .orElseThrow(() -> new AccessDeniedException("会话所属账号不存在，不能操作"));
    if (!visible(user)) throw new AccessDeniedException("该会话不在您的授权范围内");
    // 猜到 UUID 也不能绕过列表范围；跨账号撤销还要防止低权限管理员强制下线高权限账号。
    // 关闭本人会话属于自助退出，无需获得授予本人角色的权限。
    if (!Objects.equals(user.getId(), access.current().getId())) access.checkGrant(user.getRoles());
    sessions.delete(s);
    return ApiResponse.ok(null);
  }
}
