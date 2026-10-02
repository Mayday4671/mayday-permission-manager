package com.mayday.service;

import com.mayday.system.model.ChangeAudit;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.ChangeAuditRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/** 显式业务审计：由用例提供脱敏快照，禁止通过反射自动记录实体的密码、联系方式和正文。 */
@Service
@RequiredArgsConstructor
public class ChangeAuditService {
  private final ChangeAuditRepository repository;
  private final ObjectMapper mapper;

  /** 单字段可读差异；集合等复杂值由业务转为稳定、已脱敏的文本。 */
  @Schema(requiredProperties = {"field", "before", "after"})
  public record Difference(String field, String before, String after) {}

  /** 审计必须在已有业务事务中执行；业务失败时同步回滚，避免留下“已成功修改”的假证据。 */
  @Transactional(propagation = Propagation.MANDATORY)
  public void record(
      String resource,
      Long resourceId,
      String action,
      Map<String, ?> before,
      Map<String, ?> after) {
    List<Difference> differences = differences(before, after);
    if (differences.isEmpty()) return;
    var authentication = SecurityContextHolder.getContext().getAuthentication();
    String actor =
        authentication != null && authentication.getPrincipal() instanceof SysUser user
            ? user.getUsername()
            : "system";
    ChangeAudit audit = new ChangeAudit();
    audit.setActor(actor);
    audit.setResource(resource);
    audit.setResourceId(resourceId);
    audit.setAction(action);
    audit.setChangesJson(mapper.writeValueAsString(differences));
    repository.save(audit);
  }

  /** 不允许秘密字段进入日志；即使未来调用方误传，也直接拒绝而不是泄露后补救。 */
  public static List<Difference> differences(Map<String, ?> before, Map<String, ?> after) {
    Set<String> fields = new TreeSet<>(before.keySet());
    fields.addAll(after.keySet());
    List<Difference> result = new ArrayList<>();
    for (String field : fields) {
      if (field.matches("(?i).*(password|secret|token|email|phone|正文|密码|令牌|邮箱|电话).*"))
        throw new IllegalArgumentException("禁止审计秘密或联系方式字段");
      Object previous = before.get(field);
      Object current = after.get(field);
      if (!Objects.equals(previous, current))
        result.add(new Difference(field, display(previous), display(current)));
    }
    return List.copyOf(result);
  }

  private static String display(Object value) {
    if (value == null) return "—";
    String text = String.valueOf(value);
    return text.length() <= 4000 ? text : text.substring(0, 4000) + "…";
  }
}
