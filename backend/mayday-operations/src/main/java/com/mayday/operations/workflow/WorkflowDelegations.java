package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.FlowDelegation;
import com.mayday.operations.repository.FlowDefinitionRepository;
import com.mayday.operations.repository.FlowDelegationRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 按账号管理限时委托，任务激活时再核验权限；没有递归转委托或永久代办身份。 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WorkflowDelegations {
  private final FlowDelegationRepository delegations;
  private final FlowDefinitionRepository definitions;
  private final UserRepository users;
  private final AccessPolicy access;
  private final WorkflowJson json;

  /** 身份由当前会话取得，客户端只能选择接收人、时段、流程范围与原因。 */
  public record Create(
      @NotNull Long targetId,
      @NotNull LocalDateTime startsAt,
      @NotNull LocalDateTime endsAt,
      @Size(max = 50) Set<Long> definitionIds,
      @NotBlank @Size(max = 500) String reason) {}

  /** 创建审批委托需要独立权限；查看权限不能创建委托或改变待办归属。 */
  private void requireOwner() {
    access.require("requests:delegate");
    access.require("requests:approve");
    access.require("requests:view");
  }

  /**
   * 已激活任务的委托来源以不可改写的安排 ownerId 为准，不能把先前管理员交接保存的 originalAssigneeId 当成委托人。撤销或到期不改变历史来源，本方法不授予接口访问权。
   */
  boolean ownedBy(Long delegationId, Long userId) {
    return delegationId != null
        && delegations
            .findById(delegationId)
            .map(item -> item.getOwnerId().equals(userId))
            .orElse(false);
  }

  /** 委托范围目录只返回已发布启用流程名称，不泄露模型、表单、人员或业务内容。 */
  public List<Map<String, Object>> scopeOptions() {
    requireOwner();
    return definitions.findAll().stream()
        .filter(d -> d.isEnabled() && d.getPublishedVersionId() != null)
        .map(d -> Map.<String, Object>of("value", d.getId(), "label", d.getName()))
        .toList();
  }

  /** 本人创建或收到的委托由 SQL 分页，不接受任意用户编号读取他人安排。 */
  public PageResult<Map<String, Object>> list(String box, int page, int size) {
    requireOwner();
    if (!Set.of("mine", "received").contains(box)) throw new BusinessException("未知委托列表");
    return PageResult.from(
        delegations
            .findAll(
                (r, q, c) ->
                    c.equal(
                        r.get(box.equals("mine") ? "ownerId" : "targetId"),
                        access.current().getId()),
                PageResult.request(page, size))
            .map(this::view));
  }

  /** 固定账号锁顺序避免互相委托的死锁；重叠、双重安排和任何转委托链均拒绝。 */
  @Transactional
  public Map<String, Object> create(Create input) {
    requireOwner();
    access.require("users:view");
    Long ownerId = access.current().getId();
    if (ownerId.equals(input.targetId())) throw new BusinessException("不能委托给自己");
    LocalDateTime now = LocalDateTime.now();
    if (input.startsAt().isBefore(now.minusMinutes(1))
        || !input.endsAt().isAfter(input.startsAt())
        || Duration.between(input.startsAt(), input.endsAt()).compareTo(Duration.ofDays(90)) > 0
        || input.startsAt().isAfter(now.plusDays(90)))
      throw new BusinessException("委托时段必须尚未开始，最长90天，开始时间不超过90天后");
    for (Long id : List.of(ownerId, input.targetId()).stream().sorted().toList())
      users.lockById(id).orElseThrow(() -> new BusinessException("委托账号不存在"));
    var target =
        users
            .findById(input.targetId())
            .filter(u -> access.hasFor(u, "requests:approve") && access.hasFor(u, "requests:view"))
            .orElseThrow(() -> new BusinessException("接收人须启用并有审批及申请查看权限"));
    access.checkData("users", target.getId(), target.getDepartmentId());
    if (!delegations.overlapping(ownerId, input.startsAt(), input.endsAt()).isEmpty())
      throw new BusinessException("当前时段已有委托或接收安排，不能重复或转委托");
    if (delegations.overlapping(target.getId(), input.startsAt(), input.endsAt()).stream()
        .anyMatch(d -> d.getOwnerId().equals(target.getId())))
      throw new BusinessException("接收人在此时段已委托他人，不能建立委托链");
    Set<Long> ids = input.definitionIds() == null ? Set.of() : input.definitionIds();
    for (Long id : ids)
      if (id == null
          || definitions
              .findById(id)
              .filter(d -> d.isEnabled() && d.getPublishedVersionId() != null)
              .isEmpty()) throw new BusinessException("委托范围只能选择已发布且启用的流程");
    var delegation = new FlowDelegation();
    delegation.setOwnerId(ownerId);
    delegation.setOwnerName(access.current().getNickname());
    delegation.setTargetId(target.getId());
    delegation.setTargetName(target.getNickname());
    delegation.setStartsAt(input.startsAt());
    delegation.setEndsAt(input.endsAt());
    delegation.setDefinitionIdsJson(json.write(Map.of("ids", ids.stream().sorted().toList())));
    delegation.setReason(input.reason().trim());
    return view(delegations.saveAndFlush(delegation));
  }

  /** 只有本人能撤销，先锁本人再核对版本；撤销不可改成他人的委托或重新启用旧记录。 */
  @Transactional
  public Map<String, Object> revoke(Long id, Long version) {
    requireOwner();
    users.lockById(access.current().getId()).orElseThrow();
    var delegation = delegations.findById(id).orElseThrow(() -> new BusinessException("委托不存在"));
    if (!delegation.getOwnerId().equals(access.current().getId()))
      throw new AccessDeniedException("只能撤销本人创建的委托");
    OperationSupport.version(delegation, version);
    if (delegation.getRevokedAt() != null) throw new BusinessException("委托已撤销");
    delegation.setRevokedAt(LocalDateTime.now());
    delegations.flush();
    return view(delegation);
  }

  /** 后续任务读取有效安排，不追溯改写在途已激活任务；原账号停用或授权撤销时委托不生效。 */
  public Optional<FlowDelegation> effective(Long ownerId, Long definitionId) {
    if (users
        .findById(ownerId)
        .filter(
            u ->
                access.hasFor(u, "requests:delegate")
                    && access.hasFor(u, "requests:approve")
                    && access.hasFor(u, "requests:view"))
        .isEmpty()) return Optional.empty();
    return delegations.effective(ownerId, LocalDateTime.now()).stream()
        .filter(d -> scopeIds(d).isEmpty() || scopeIds(d).contains(definitionId))
        .filter(
            d ->
                users
                    .findById(d.getTargetId())
                    .filter(
                        u ->
                            access.hasFor(u, "requests:approve")
                                && access.hasFor(u, "requests:view"))
                    .isPresent())
        .findFirst();
  }

  private List<Long> scopeIds(FlowDelegation delegation) {
    Object value = json.form(delegation.getDefinitionIdsJson()).get("ids");
    if (!(value instanceof List<?> list)) throw new BusinessException("委托范围存储损坏");
    return list.stream().map(v -> WorkflowSchema.positiveId(v, "委托流程")).toList();
  }

  private Map<String, Object> view(FlowDelegation delegation) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", delegation.getId());
    out.put("version", delegation.getVersion());
    out.put("ownerId", delegation.getOwnerId());
    out.put("ownerName", delegation.getOwnerName());
    out.put("targetId", delegation.getTargetId());
    out.put("targetName", delegation.getTargetName());
    out.put("startsAt", delegation.getStartsAt());
    out.put("endsAt", delegation.getEndsAt());
    out.put("definitionIds", scopeIds(delegation));
    out.put("reason", delegation.getReason());
    out.put("revokedAt", delegation.getRevokedAt());
    out.put("createdAt", delegation.getCreatedAt());
    LocalDateTime now = LocalDateTime.now();
    out.put(
        "status",
        delegation.getRevokedAt() != null
            ? "REVOKED"
            : !delegation.getEndsAt().isAfter(now)
                ? "EXPIRED"
                : delegation.getStartsAt().isAfter(now) ? "SCHEDULED" : "ACTIVE");
    return out;
  }
}
