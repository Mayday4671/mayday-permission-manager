package com.mayday.operations.workflow;

import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Node;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;

/** 常用流程只提供安全的可编辑草稿骨架，不自动发布、不替用户选择跨部门审批人。 从模板创建仍走原保存、发布与引用校验；已发布申请继续使用自己的不可变快照。 */
public final class WorkflowTemplates {
  private WorkflowTemplates() {}

  /** 模板只有只读定义，无发布状态或授权身份，复制后必须按正常流程校验和发布。 */
  public record Template(String key, String name, String description, Spec schema) {}

  /** 默认由发起人部门负责人审批，管理员可在设计器中更换审批来源、字段或分支。 */
  public static List<Template> all() {
    return List.of(
        template(
            "leave",
            "请假申请",
            "请假类型、日期、天数及说明，部门负责人审批。",
            List.of(
                new Field(
                    "leaveType",
                    "请假类型",
                    "SINGLE",
                    true,
                    12,
                    null,
                    null,
                    null,
                    List.of("事假", "年假", "病假", "其他")),
                field("startDate", "开始日期", "DATE", 12),
                field("endDate", "结束日期", "DATE", 12),
                new Field(
                    "days",
                    "请假天数",
                    "NUMBER",
                    true,
                    12,
                    new BigDecimal("0.5"),
                    new BigDecimal("365"),
                    null,
                    null),
                field("reason", "请假原因", "TEXTAREA", 24))),
        template(
            "expense",
            "费用报销",
            "费用类别、金额、用途及票据附件，部门负责人审批。",
            List.of(
                new Field(
                    "expenseType",
                    "费用类别",
                    "SINGLE",
                    true,
                    12,
                    null,
                    null,
                    null,
                    List.of("差旅", "办公", "交通", "其他")),
                new Field(
                    "amount",
                    "报销金额",
                    "MONEY",
                    true,
                    12,
                    BigDecimal.ZERO,
                    new BigDecimal("1000000"),
                    null,
                    null),
                field("reason", "费用说明", "TEXTAREA", 24),
                new Field("receipts", "票据附件", "FILES", false, 24, null, null, null, null))),
        template(
            "purchase",
            "采购申请",
            "物品名称、数量、预算及用途，部门负责人审批。",
            List.of(
                field("item", "采购物品", "TEXT", 24),
                new Field(
                    "quantity",
                    "数量",
                    "NUMBER",
                    true,
                    12,
                    BigDecimal.ONE,
                    new BigDecimal("100000"),
                    null,
                    null),
                new Field(
                    "budget",
                    "预算金额",
                    "MONEY",
                    true,
                    12,
                    BigDecimal.ZERO,
                    new BigDecimal("10000000"),
                    null,
                    null),
                field("reason", "采购用途", "TEXTAREA", 24))));
  }

  private static Field field(String id, String label, String type, int width) {
    // 分开赋值保留非文本字段的 null，避免数值与 null 嵌套三元表达式触发隐式拆箱。
    Integer maxLength = null;
    if ("TEXTAREA".equals(type)) maxLength = 2000;
    else if ("TEXT".equals(type)) maxLength = 200;
    return new Field(id, label, type, true, width, null, null, maxLength, null);
  }

  private static Template template(
      String key, String name, String description, List<Field> fields) {
    Set<String> readable =
        fields.stream().map(Field::id).collect(java.util.stream.Collectors.toUnmodifiableSet());
    Node review =
        new Node(
            "review",
            "部门负责人审批",
            "APPROVAL",
            "end",
            "DEPARTMENT_LEADER",
            List.of(),
            "ALL",
            readable,
            Set.of(),
            Set.of("APPROVE", "REJECT", "COMMENT", "TRANSFER"),
            List.of(),
            1440);
    Node end =
        new Node(
            "end", "结束", "END", null, null, List.of(), null, Set.of(), Set.of(), Set.of(),
            List.of());
    return new Template(
        key,
        name,
        description,
        new Spec(fields, List.of(review, end), "review", "ALL", Set.of(), false, false, true));
  }
}
