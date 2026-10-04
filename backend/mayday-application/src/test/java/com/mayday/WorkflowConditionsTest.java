package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowConditions;
import com.mayday.operations.workflow.WorkflowConditions.Rule;
import com.mayday.operations.workflow.WorkflowJson;
import com.mayday.operations.workflow.WorkflowSchema;
import com.mayday.operations.workflow.WorkflowSchema.Condition;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** 组合条件的真实发布契约和执行语义：优先级、嵌套、空值、边界及旧 JSON 均不能改变审批路由。 */
class WorkflowConditionsTest {
  private Rule leaf(String field, String operator, String value) {
    return new Rule(field, operator, value, null, List.of());
  }

  private Rule group(String logic, Rule... rules) {
    return new Rule(null, null, null, logic, List.of(rules));
  }

  private Condition branch(Rule rule) {
    return new Condition(null, null, null, "special", rule);
  }

  private Spec spec(Condition condition) {
    List<Field> fields =
        List.of(
            new Field("amount", "金额", "MONEY", true, 12, null, null, null, null),
            new Field(
                "kind", "类型", "SINGLE", true, 12, null, null, null, List.of("采购", "差旅", "其他")));
    Node start =
        new Node(
            "review",
            "审批",
            "APPROVAL",
            "choice",
            "USERS",
            List.of(1L),
            "ALL",
            Set.of("amount", "kind"),
            Set.of(),
            Set.of("APPROVE", "REJECT"),
            List.of());
    Node choice =
        new Node(
            "choice",
            "条件",
            "CONDITION",
            "end",
            null,
            List.of(),
            null,
            Set.of(),
            Set.of(),
            Set.of(),
            List.of(condition));
    Node special =
        new Node(
            "special",
            "加审",
            "APPROVAL",
            "end",
            "USERS",
            List.of(2L),
            "ALL",
            Set.of(),
            Set.of(),
            Set.of("APPROVE", "REJECT"),
            List.of());
    Node end =
        new Node(
            "end", "结束", "END", null, null, List.of(), null, Set.of(), Set.of(), Set.of(),
            List.of());
    return new Spec(
        fields,
        List.of(start, choice, special, end),
        "review",
        "ALL",
        Set.of(),
        false,
        false,
        true);
  }

  /** 大额且指定申请类型才加审；嵌套 OR 不能被错误摊平为三个独立分支。 */
  @Test
  void evaluatesNestedGroupsAndKeepsDefaultRoute() {
    Spec spec =
        spec(
            branch(
                group(
                    "AND",
                    leaf("amount", "GT", "1000"),
                    group("OR", leaf("kind", "EQ", "采购"), leaf("kind", "EQ", "差旅")))));
    WorkflowSchema.validate(spec);
    assertEquals(
        "special",
        WorkflowSchema.next(
            spec.node("choice"), Map.of("amount", new BigDecimal("1000.01"), "kind", "采购")));
    assertEquals(
        "end", WorkflowSchema.next(spec.node("choice"), Map.of("amount", 999, "kind", "差旅")));
    assertEquals(
        "end", WorkflowSchema.next(spec.node("choice"), Map.of("amount", 5000, "kind", "其他")));
    assertEquals("end", WorkflowSchema.next(spec.node("choice"), Map.of("amount", 5000)));
  }

  /** NE 不把未填写当成其他值，OR 只要存在一个真实匹配即可命中。 */
  @Test
  void absentValuesNeverSatisfyNotEqualAndOrAllowsOneMatch() {
    assertFalse(WorkflowConditions.matches(branch(leaf("kind", "NE", "采购")), Map.of()));
    assertTrue(
        WorkflowConditions.matches(
            branch(group("OR", leaf("kind", "EQ", "采购"), leaf("amount", "GE", "1000"))),
            Map.of("amount", 1000)));
  }

  /** 直接接口配置也不得使用被删除的选项、字符串大小比较或未知字段。 */
  @Test
  void nestedInvalidReferencesAreRejectedByDraftAndPublish() {
    Spec removed = spec(branch(group("AND", leaf("kind", "EQ", "失效选项"))));
    assertThrows(BusinessException.class, () -> WorkflowSchema.validateDraft(removed));
    assertThrows(BusinessException.class, () -> WorkflowSchema.validate(removed));
    assertThrows(
        BusinessException.class,
        () -> WorkflowSchema.validate(spec(branch(leaf("kind", "GT", "采购")))));
    assertThrows(
        BusinessException.class,
        () -> WorkflowSchema.validate(spec(branch(leaf("missing", "EQ", "采购")))));
  }

  /** 总叶子数与分组深度有限，阻止巨型或歧义模型消耗执行资源。 */
  @Test
  void rejectsAmbiguousEmptyDeepAndOversizedGroups() {
    var one = leaf("amount", "GT", "1000");
    assertThrows(BusinessException.class, () -> WorkflowConditions.leaves(branch(group("AND"))));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowConditions.leaves(
                branch(new Rule(null, null, null, "OR", Collections.nCopies(21, one)))));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowConditions.leaves(
                branch(group("AND", group("AND", group("AND", group("AND", one)))))));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowConditions.leaves(
                new Condition("amount", "GT", "1000", "special", group("AND", one))));
  }

  /** 新 JSON 冻结全部组合结构，旧 JSON 没有 predicate 仍按单条件执行。 */
  @Test
  void frozenJsonAndLegacyConditionsRetainTheirSemantics() {
    var json = new WorkflowJson();
    Spec grouped =
        spec(branch(group("AND", leaf("amount", "GT", "1000"), leaf("kind", "EQ", "采购"))));
    assertEquals(grouped, json.spec(json.write(grouped)));
    Spec legacy = spec(new Condition("kind", "EQ", "差旅", "special"));
    String saved = json.write(legacy).replace(",\"predicate\":null", "");
    assertEquals(
        "special", WorkflowSchema.next(json.spec(saved).node("choice"), Map.of("kind", "差旅")));
  }
}
