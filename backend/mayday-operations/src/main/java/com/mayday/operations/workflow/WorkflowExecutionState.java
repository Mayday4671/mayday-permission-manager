package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * 审批实例内部的持久执行游标，不接受客户端提交。每条并行支路持有独立游标与办理批次， 父游标等待全部子游标到达专属汇合点后才继续。JSON 与申请主记录在同一行锁事务中提交，
 * 服务重启只读取已保存状态，不重新创建已进入的任务或子申请。
 */
@Getter
@Setter
public final class WorkflowExecutionState {
  private int formatVersion = 1;
  private List<Token> tokens = new ArrayList<>();

  /**
   * UUID 只在首次进入或重开支路时产生，不能复用废弃批次的办理凭证。 parentTokenId 表示并行父支路，childRequestId 表示固定子流程申请，两者含义不同。 error
   * 仅通过管理员恢复入口回显，普通参与人只看到需要管理员处理的状态。
   */
  @Getter
  @Setter
  public static final class Token {
    private String id;
    private String nodeId;
    private String parentTokenId;
    private String joinNodeId;
    private String status = "ACTIVE";
    private int nodeVisit;
    private Long childRequestId;
    private String error;
    private List<String> trail = new ArrayList<>();
  }

  /** 新游标继承当前实际办理路径；后续修改其路径不影响另一条支路的退回目标。 */
  public Token add(String nodeId, String parentTokenId, List<String> trail) {
    if (tokens.size() >= 200) throw new BusinessException("当前轮执行支路超过安全上限");
    Token token = new Token();
    token.setId(UUID.randomUUID().toString());
    token.setNodeId(nodeId);
    token.setParentTokenId(parentTokenId);
    token.setTrail(new ArrayList<>(trail));
    tokens.add(token);
    return token;
  }

  /** 缺少办理游标表示任务已被废弃或数据损坏，不能退化为普通单线审批继续处理。 */
  public Token require(String tokenId) {
    return tokens.stream()
        .filter(token -> Objects.equals(token.getId(), tokenId))
        .findFirst()
        .orElseThrow(() -> new BusinessException("审批执行支路不存在，请刷新申请"));
  }

  /** 用于移除废弃支路全部后代；返回的是稳定编号集合，调用方仍需在根申请锁内更新。 */
  public Set<String> descendants(String tokenId) {
    Set<String> result = new java.util.LinkedHashSet<>();
    result.add(tokenId);
    boolean changed;
    do {
      changed = false;
      for (Token token : tokens)
        if (result.contains(token.getParentTokenId()) && result.add(token.getId())) changed = true;
    } while (changed);
    return result;
  }

  /** 只验证内部保存结构；旧申请没有该快照时继续使用原单线运行端。 */
  public void validate() {
    if (formatVersion != 1 || tokens == null || tokens.isEmpty() || tokens.size() > 200)
      throw new BusinessException("审批执行快照无法读取，请联系管理员");
    Set<String> ids = new java.util.HashSet<>();
    for (Token token : tokens)
      if (token == null
          || token.getId() == null
          || token.getId().length() != 36
          || !ids.add(token.getId())
          || token.getNodeId() == null
          || token.getTrail() == null
          || token.getTrail().size() > 200
          || token.getTrail().stream().anyMatch(Objects::isNull)
          || token.getNodeVisit() < 0
          || !Set.of("ACTIVE", "APPROVAL", "WAIT_JOIN", "WAIT_CHILD", "FAILED", "DONE", "CANCELLED")
              .contains(token.getStatus())) throw new BusinessException("审批执行快照损坏，请联系管理员");
    for (Token token : tokens)
      if (token.getParentTokenId() != null && !ids.contains(token.getParentTokenId()))
        throw new BusinessException("审批执行支路失去父游标，请联系管理员");
    // 数据库快照同样不能被盲目信任：父指针回环会破坏退回边界及汇合判定，必须先拒绝读取。
    for (Token token : tokens) {
      Set<String> parents = new java.util.HashSet<>();
      Token current = token;
      while (current != null) {
        if (!parents.add(current.getId())) throw new BusinessException("审批执行游标存在父级循环，请联系管理员");
        current = current.getParentTokenId() == null ? null : require(current.getParentTokenId());
      }
    }
  }
}
