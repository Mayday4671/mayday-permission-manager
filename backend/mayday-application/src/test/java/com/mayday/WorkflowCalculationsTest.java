package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowCalculations;
import com.mayday.operations.workflow.WorkflowCalculations.Formula;
import com.mayday.operations.workflow.WorkflowSchema;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import com.mayday.operations.workflow.WorkflowSchema.Spec;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** 计算字段属于业务可信边界：测试精确小数、篡改结果、依赖环、草稿暂缺及明细/日期的真实提交规范化。 */
class WorkflowCalculationsTest {
  private Field input(String id, String type) {
    return new Field(id, id, type, false, 12, null, null, null, null);
  }

  private Field calculated(
      String id, String operation, List<String> operands, String column, int scale) {
    return new Field(
        id,
        id,
        "CALCULATED",
        true,
        12,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Formula(operation, operands, column, scale));
  }

  private Spec spec(Field... fields) {
    return new Spec(List.of(fields), List.of(), "", "ALL", Set.of(), false, false, true);
  }

  /** 客户端伪造结果无效，且计算字段先于来源排列也能按依赖顺序重算。 */
  @Test
  void recalculatesSubmittedResultsWithExactDecimalsAndDependencyOrder() {
    Spec schema =
        spec(
            calculated("gross", "MULTIPLY", List.of("sum", "quantity"), null, 2),
            calculated("sum", "SUM", List.of("first", "second"), null, 2),
            input("first", "MONEY"),
            input("second", "MONEY"),
            input("quantity", "NUMBER"));
    var result =
        WorkflowSchema.form(
            schema,
            Map.of(
                "first",
                "0.10",
                "second",
                "0.20",
                "quantity",
                3,
                "sum",
                8888,
                "gross",
                "malicious script"));
    assertEquals(new BigDecimal("0.30"), result.get("sum"));
    assertEquals(new BigDecimal("0.90"), result.get("gross"));
  }

  /** 明细汇总来自规范化行值，金额与跨闰日天数均保留真实含义。 */
  @Test
  void sumsDetailRowsAndIncludesBothCalendarEndpoints() {
    Field detail =
        new Field(
            "items",
            "费用",
            "DETAILS",
            true,
            24,
            null,
            null,
            null,
            null,
            null,
            null,
            List.of(input("amount", "MONEY")),
            20);
    var result =
        WorkflowSchema.form(
            spec(
                detail,
                input("period", "DATE_RANGE"),
                calculated("total", "DETAIL_SUM", List.of("items"), "amount", 2),
                calculated("days", "DATE_DAYS", List.of("period"), null, 0)),
            Map.of(
                "items",
                List.of(Map.of("amount", "19.95"), Map.of("amount", "0.05")),
                "period",
                List.of("2024-02-28", "2024-03-01")));
    assertEquals(new BigDecimal("20.00"), result.get("total"));
    assertEquals(new BigDecimal("3"), result.get("days"));
  }

  /** 减除按选择顺序、负数按 HALF_UP 处理，不能依赖浮点舍入。 */
  @Test
  void respectsSubtractionDivisionOrderAndSignedRounding() {
    Spec schema =
        spec(
            input("first", "NUMBER"),
            input("second", "NUMBER"),
            calculated("difference", "SUBTRACT", List.of("first", "second"), null, 3),
            calculated("quotient", "DIVIDE", List.of("first", "second"), null, 2));
    var result = WorkflowSchema.form(schema, Map.of("first", "-1.005", "second", 1));
    assertEquals(new BigDecimal("-2.005"), result.get("difference"));
    assertEquals(new BigDecimal("-1.01"), result.get("quotient"));
  }

  /** 草稿允许暂缺，正式提交不允许必填计算无结果；零除必须明确错误。 */
  @Test
  void draftsMayRemainIncompleteButSubmissionRejectsMissingSourcesAndDivisionByZero() {
    Spec schema =
        spec(
            input("first", "NUMBER"),
            input("second", "NUMBER"),
            calculated("total", "DIVIDE", List.of("first", "second"), null, 2));
    assertNull(WorkflowSchema.form(schema, Map.of("first", 1), false).get("total"));
    assertNull(WorkflowSchema.form(schema, Map.of("first", 1, "second", 0), false).get("total"));
    assertThrows(BusinessException.class, () -> WorkflowSchema.form(schema, Map.of("first", 1)));
    assertThrows(
        BusinessException.class,
        () -> WorkflowSchema.form(schema, Map.of("first", 1, "second", 0)));
  }

  /** 自引用、间接循环和已经删除的列必须在保存草稿之前暴露。 */
  @Test
  void rejectsCyclesMissingReferencesAndNonNumericSources() {
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowCalculations.validate(
                List.of(
                    calculated("a", "SUM", List.of("b"), null, 2),
                    calculated("b", "SUM", List.of("a"), null, 2))));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowCalculations.validate(
                List.of(calculated("a", "SUM", List.of("missing"), null, 2))));
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowCalculations.validate(
                List.of(input("memo", "TEXT"), calculated("a", "SUM", List.of("memo"), null, 2))));
    Field detail =
        new Field(
            "items",
            "明细",
            "DETAILS",
            false,
            24,
            null,
            null,
            null,
            null,
            null,
            null,
            List.of(input("amount", "MONEY")),
            10);
    assertThrows(
        BusinessException.class,
        () ->
            WorkflowCalculations.validate(
                List.of(detail, calculated("a", "DETAIL_SUM", List.of("items"), "removed", 2))));
  }

  /** 金额溢出不能靠客户端校验阻止，超出约定大小的结果由服务端拒绝。 */
  @Test
  void rejectsOverflowAndUnexpectedFields() {
    Spec schema =
        spec(
            input("amount", "NUMBER"),
            input("quantity", "NUMBER"),
            calculated("total", "MULTIPLY", List.of("amount", "quantity"), null, 0));
    assertThrows(
        BusinessException.class,
        () -> WorkflowSchema.form(schema, Map.of("amount", "1000000000000000", "quantity", 10)));
    assertThrows(
        BusinessException.class,
        () -> WorkflowSchema.form(schema, Map.of("amount", 1, "quantity", 2, "unregistered", 3)));
  }
}
