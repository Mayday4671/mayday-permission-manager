package com.mayday.operations.web;

import com.mayday.common.*;
import com.mayday.security.*;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.*;
import java.time.Instant;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** 会话响应使用独立 UUID，绝不返回 token 或其摘要；管理员只能撤销自己有权管理的账号会话。 */
@RestController
@RequestMapping("/api/operations/sessions")
@RequiredArgsConstructor
public class SessionController {
  private final SessionRepository sessions;
  private final UserRepository users;
  private final AccessPolicy access;

  /** 本人会话允许自助查看；其他账号必须落在实时用户数据范围内，不能由 sessions:view 隐式扩权。 */
  private boolean visible(SysUser user) {
    return Objects.equals(user.getId(), access.current().getId()) || access.canViewUser(user);
  }

  @GetMapping
  @Transactional(readOnly = true)
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size,
      @RequestHeader("Authorization") String auth) {
    access.require("sessions:view");
    String current = TokenService.hash(auth.substring(7));
    var result =
        sessions.findAll().stream()
            .filter(s -> s.getExpiresAt().isAfter(Instant.now()))
            .flatMap(
                s ->
                    users.findById(s.getUserId()).stream()
                        .filter(u -> u.isEnabled())
                        // 必须先过滤授权范围再搜索、统计和分页，避免总数及关键词探测泄露账号存在性。
                        .filter(this::visible)
                        .filter(
                            u ->
                                u.getUsername().contains(keyword)
                                    || u.getNickname().contains(keyword))
                        .map(
                            u -> {
                              Map<String, Object> m = new LinkedHashMap<>();
                              m.put("id", s.getSessionId());
                              m.put("username", u.getUsername());
                              m.put("nickname", u.getNickname());
                              m.put("createdAt", s.getCreatedAt());
                              m.put("lastActiveAt", s.getLastActiveAt());
                              m.put("expiresAt", s.getExpiresAt());
                              m.put("ip", s.getIp());
                              m.put("device", s.getDevice());
                              m.put("current", current.equals(s.getTokenHash()));
                              return m;
                            }))
            .sorted(
                Comparator.comparing(
                    m -> String.valueOf(m.get("createdAt")), Comparator.reverseOrder()))
            .toList();
    int limit = Math.max(1, Math.min(size, 100)),
        start =
            Math.min(
                result.size(),
                (int) Math.min(Integer.MAX_VALUE, Math.max(0L, (long) page - 1) * limit));
    return ApiResponse.ok(
        Map.of(
            "items",
            result.subList(start, Math.min(start + limit, result.size())),
            "total",
            result.size(),
            "page",
            Math.max(1, page),
            "size",
            limit));
  }

  @DeleteMapping("/{id}")
  @Transactional
  public ApiResponse<?> revoke(@PathVariable String id) {
    access.require("sessions:view");
    access.require("sessions:revoke");
    var s =
        sessions.findAll().stream()
            .filter(v -> Objects.equals(v.getSessionId(), id))
            .findFirst()
            .orElseThrow(() -> new BusinessException("会话已失效"));
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
