package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowSchema.Condition;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** 有界组合条件。旧单条件兼容；AND/OR 可以分组，不执行脚本，不让默认路线掩盖非法模型。 */
public final class WorkflowConditions {
  private WorkflowConditions() {}

  /** 叶子只保存字段/运算/值；组只保存 logic 和 children，两种表示不能同时存在。 */
  public record Rule(
      String field, String operator, String value, String logic, List<Rule> children) {
    public Rule {
      children = children == null ? List.of() : List.copyOf(children);
    }
  }

  /** 完整发布检查、草稿选项引用与字段删除检查共用叶子遍历；深度和总条数先限制。 */
  public static List<Rule> leaves(Condition condition) {
    if (condition.predicate() == null)
      return List.of(
          new Rule(condition.field(), condition.operator(), condition.value(), null, List.of()));
    require(
        condition.field() == null && condition.operator() == null && condition.value() == null,
        "组合条件不能同时配置旧单条件");
    List<Rule> result = new ArrayList<>();
    flatten(condition.predicate(), 0, result);
    return List.copyOf(result);
  }

  private static void flatten(Rule rule, int depth, List<Rule> leaves) {
    require(rule != null && depth <= 3, "组合条件最多嵌套 3 层分组");
    if (rule.logic() != null) {
      require(
          Set.of("AND", "OR").contains(rule.logic())
              && rule.field() == null
              && rule.operator() == null
              && rule.value() == null,
          "条件分组必须仅设置全部满足或任一满足");
      require(!rule.children().isEmpty() && rule.children().size() <= 20, "条件分组需要 1 至 20 条判断");
      for (Rule child : rule.children()) flatten(child, depth + 1, leaves);
    } else {
      require(rule.children().isEmpty(), "单条件不能包含子条件");
      leaves.add(rule);
      require(leaves.size() <= 20, "一个分支最多 20 条判断");
    }
  }

  /** 空字段对所有运算均不匹配，包括 NE；路径顺序仍由节点条件列表决定。 */
  public static boolean matches(Condition condition, Map<String, Object> values) {
    var leaves = leaves(condition);
    return condition.predicate() == null
        ? matchesLeaf(leaves.getFirst(), values)
        : matchesRule(condition.predicate(), values);
  }

  private static boolean matchesRule(Rule rule, Map<String, Object> values) {
    if ("AND".equals(rule.logic()))
      return rule.children().stream().allMatch(child -> matchesRule(child, values));
    if ("OR".equals(rule.logic()))
      return rule.children().stream().anyMatch(child -> matchesRule(child, values));
    return matchesLeaf(rule, values);
  }

  private static boolean matchesLeaf(Rule rule, Map<String, Object> values) {
    Object value = values.get(rule.field());
    if (value == null) return false;
    return switch (Objects.toString(rule.operator(), "")) {
      case "EQ" ->
          value instanceof Number
              ? new BigDecimal(value.toString()).compareTo(new BigDecimal(rule.value())) == 0
              : value.toString().equals(rule.value());
      case "NE" ->
          value instanceof Number
              ? new BigDecimal(value.toString()).compareTo(new BigDecimal(rule.value())) != 0
              : !value.toString().equals(rule.value());
      case "CONTAINS" -> value.toString().contains(rule.value());
      case "GT", "GE", "LT", "LE" -> {
        int comparison = new BigDecimal(value.toString()).compareTo(new BigDecimal(rule.value()));
        yield switch (rule.operator()) {
          case "GT" -> comparison > 0;
          case "GE" -> comparison >= 0;
          case "LT" -> comparison < 0;
          default -> comparison <= 0;
        };
      }
      default -> throw new BusinessException("条件比较方式无效");
    };
  }

  private static void require(boolean valid, String message) {
    if (!valid) throw new BusinessException(message);
  }
}
