package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 可执行并行图的结构保护。并行组必须有专属汇合点，各支路的全部出口均经过该点； 分支不能共享中间审批节点、提前结束或从组外进入，避免一项任务被多个游标重复创建。
 * 条件仍只选择一条路线，并行则创建全部路线，不以画布连线冒充运行语义。
 */
public final class WorkflowOrchestration {
  private WorkflowOrchestration() {}

  /** 返回真实运行出口；PARALLEL.next 保存专属汇合点，不是绕过全部支路的默认路线。 */
  public static List<String> exits(Node node) {
    if ("END".equals(node.type())) return List.of();
    if ("PARALLEL".equals(node.type())) return node.branches();
    List<String> result = new ArrayList<>();
    result.add(node.next());
    if ("CONDITION".equals(node.type()))
      node.conditions().forEach(condition -> result.add(condition.next()));
    return result;
  }

  /** 新编排发布后使用游标引擎；已有单线模型没有新增执行类型时保持原运行行为。 */
  public static boolean required(Spec spec) {
    return spec.nodes().stream()
        .anyMatch(node -> Set.of("PARALLEL", "JOIN", "SUBPROCESS").contains(node.type()));
  }

  /** 先由主验证器拒绝循环与无效出口，再校验并行专属成员和读写冲突。 */
  public static void validate(Spec spec) {
    Map<String, Node> nodes = new LinkedHashMap<>();
    spec.nodes().forEach(node -> nodes.put(node.id(), node));
    Set<String> ownedJoins = new HashSet<>();
    for (Node fork : spec.nodes()) {
      if (!"PARALLEL".equals(fork.type())) {
        require(fork.branches().isEmpty(), "只有并行节点可以配置同时执行的支路");
        continue;
      }
      require(fork.branches().size() >= 2 && fork.branches().size() <= 10, "并行节点需要 2 至 10 条支路");
      require(new HashSet<>(fork.branches()).size() == fork.branches().size(), "并行支路入口不能重复");
      Node join = nodes.get(fork.next());
      require(join != null && "JOIN".equals(join.type()), "并行节点必须配置专属汇合节点");
      require(ownedJoins.add(join.id()), "汇合节点不能由两个并行组共用");
      List<Set<String>> members = new ArrayList<>();
      Set<String> all = new LinkedHashSet<>();
      Set<String> written = new HashSet<>();
      for (String branch : fork.branches()) {
        require(!Objects.equals(branch, join.id()), "并行支路不能为空，请添加审批或子流程");
        Set<String> branchMembers = new LinkedHashSet<>();
        collect(nodes, branch, join.id(), branchMembers);
        require(
            branchMembers.stream()
                .anyMatch(id -> Set.of("APPROVAL", "SUBPROCESS").contains(nodes.get(id).type())),
            "每条并行支路需要审批或子流程");
        require(branchMembers.stream().noneMatch(all::contains), "并行支路不能共用汇合前的节点");
        Set<String> branchWrites = new HashSet<>();
        branchMembers.forEach(id -> branchWrites.addAll(nodes.get(id).writable()));
        require(branchWrites.stream().noneMatch(written::contains), "不同并行支路不能同时编辑同一表单字段，请在汇合后统一编辑");
        written.addAll(branchWrites);
        all.addAll(branchMembers);
        members.add(branchMembers);
      }
      // 专属节点只能由该并行组的支路进入；嵌套组的入口与成员都属于外层组，因此合法。
      for (Node source : spec.nodes())
        for (String target : exits(source))
          if ((all.contains(target) || join.id().equals(target))
              && !source.id().equals(fork.id())
              && !all.contains(source.id())) throw new BusinessException("并行组不能从组外直接进入支路或汇合节点");
      for (int left = 0; left < members.size(); left++)
        for (int right = left + 1; right < members.size(); right++)
          for (String leftId : members.get(left))
            for (String rightId : members.get(right)) {
              Node first = nodes.get(leftId), second = nodes.get(rightId);
              if (!Boolean.TRUE.equals(spec.allowRepeatApproval())
                  && "APPROVAL".equals(first.type())
                  && "APPROVAL".equals(second.type())
                  && "USERS".equals(first.source())
                  && "USERS".equals(second.source())
                  && first.assigneeIds().stream().anyMatch(second.assigneeIds()::contains))
                throw new BusinessException("同时执行的并行支路包含同一审批人，请调整人员或允许重复审批");
            }
    }
    for (Node node : spec.nodes()) {
      require(!"JOIN".equals(node.type()) || ownedJoins.contains(node.id()), "汇合节点缺少所属并行组");
      if ("SUBPROCESS".equals(node.type())) {
        require(
            node.subprocess() != null
                && node.subprocess().versionId() != null
                && node.subprocess().versionId() > 0,
            "请选择已发布的子流程版本");
        require(
            node.subprocess().inputs().size() <= 40 && node.subprocess().outputs().size() <= 40,
            "子流程字段映射最多 40 项");
        require(
            node.readable().containsAll(node.subprocess().inputs().values()), "子流程输入只能引用当前节点可读字段");
        require(
            node.writable().containsAll(node.subprocess().outputs().keySet()), "子流程输出只能写入当前节点可写字段");
      } else require(node.subprocess() == null, "只有子流程节点可以绑定子流程版本");
    }
  }

  /** 任何条件路线都必须到达专属汇合点；遇到结束节点立即拒绝，不能只检查存在一条路径。 */
  private static void collect(Map<String, Node> nodes, String id, String join, Set<String> result) {
    if (join.equals(id) || result.contains(id)) return;
    Node node = nodes.get(id);
    require(node != null && !"END".equals(node.type()), "并行支路提前结束，必须先到达汇合节点");
    result.add(id);
    for (String target : exits(node)) collect(nodes, target, join, result);
  }

  /** 运行期人员替换也要限制不同并行支路中的重复人员，不能借委托绕过发布保护。 */
  public static boolean coexecuted(Spec spec, String first, String second) {
    Map<String, Node> nodes = new LinkedHashMap<>();
    spec.nodes().forEach(node -> nodes.put(node.id(), node));
    for (Node fork : spec.nodes()) {
      if (!"PARALLEL".equals(fork.type())) continue;
      List<Set<String>> branches = new ArrayList<>();
      for (String root : fork.branches()) {
        Set<String> member = new HashSet<>();
        collect(nodes, root, fork.next(), member);
        branches.add(member);
      }
      int a = -1, b = -1;
      for (int index = 0; index < branches.size(); index++) {
        if (branches.get(index).contains(first)) a = index;
        if (branches.get(index).contains(second)) b = index;
      }
      if (a >= 0 && b >= 0 && a != b) return true;
    }
    return false;
  }

  private static void require(boolean valid, String message) {
    if (!valid) throw new BusinessException(message);
  }
}
