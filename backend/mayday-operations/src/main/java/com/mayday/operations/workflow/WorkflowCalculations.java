package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 表单计算规则的唯一服务端实现。仅执行结构化运算，不执行 JavaScript、SQL 或用户表达式。 发布检查引用和依赖环；提交、审批修改和重新提交均在原事务中重算，客户端结果不具有授权效力。
 */
public final class WorkflowCalculations {
  private static final Set<String> OPERATIONS =
      Set.of("SUM", "SUBTRACT", "MULTIPLY", "DIVIDE", "DETAIL_SUM", "DATE_DAYS");
  private static final Set<String> NUMERIC = Set.of("NUMBER", "MONEY", "CALCULATED");
  private static final BigDecimal LIMIT = new BigDecimal("1000000000000000");

  private WorkflowCalculations() {}

  /** operands 保存稳定字段 ID；明细汇总的 column 保存该明细局部列 ID。 scale 是 0–6 位小数，统一四舍五入；日期天数包含起止两天，不代表工作日或假期日历。 */
  public record Formula(String operation, List<String> operands, String column, Integer scale) {
    public Formula {
      operands = operands == null ? List.of() : List.copyOf(operands);
    }
  }

  /** 草稿同样拒绝失效引用和循环计算，避免保存一个无法试填或发布的表单。 */
  public static void validate(List<Field> fields) {
    Map<String, Field> catalog = new LinkedHashMap<>();
    fields.forEach(field -> catalog.put(field.id(), field));
    for (Field field : fields) {
      Formula formula = field.formula();
      if (!"CALCULATED".equals(field.type())) {
        require(formula == null, "只有计算字段可以设置计算规则");
        continue;
      }
      require(formula != null, field.label() + "需要配置计算规则");
      require(OPERATIONS.contains(Objects.toString(formula.operation(), "")), "计算方式无效");
      require(
          formula.scale() != null && formula.scale() >= 0 && formula.scale() <= 6,
          "计算精度应为 0 至 6 位");
      require(
          !formula.operands().isEmpty()
              && formula.operands().size() <= 10
              && new HashSet<>(formula.operands()).size() == formula.operands().size(),
          "计算需要 1 至 10 个不重复字段");
      require(catalog.keySet().containsAll(formula.operands()), field.label() + "引用的计算字段已不存在");
      if (Set.of("SUBTRACT", "DIVIDE").contains(formula.operation()))
        require(formula.operands().size() == 2, "减法和除法需要两个字段，选择顺序决定运算顺序");
      if ("DETAIL_SUM".equals(formula.operation())) {
        require(formula.operands().size() == 1, "明细汇总只能选择一个明细表");
        Field source = catalog.get(formula.operands().getFirst());
        require("DETAILS".equals(source.type()) && source.columns() != null, "汇总来源必须是明细表");
        require(
            source.columns().stream()
                .anyMatch(
                    column ->
                        column.id().equals(formula.column())
                            && Set.of("NUMBER", "MONEY").contains(column.type())),
            "汇总列必须是已有数字或金额列");
      } else if ("DATE_DAYS".equals(formula.operation())) {
        require(
            formula.operands().size() == 1
                && "DATE_RANGE".equals(catalog.get(formula.operands().getFirst()).type()),
            "日期天数需要一个日期区间字段");
        require(formula.scale() == 0, "日期天数精度应为 0");
      } else {
        require(
            formula.operands().stream().allMatch(id -> NUMERIC.contains(catalog.get(id).type())),
            "计算来源必须为数字、金额或其他计算字段");
      }
      require("DETAIL_SUM".equals(formula.operation()) || formula.column() == null, "只有明细汇总可以设置列");
    }
    Set<String> done = new HashSet<>();
    for (Field field : fields) checkDependencies(field, catalog, new HashSet<>(), done);
  }

  private static void checkDependencies(
      Field field, Map<String, Field> catalog, Set<String> visiting, Set<String> done) {
    if (!"CALCULATED".equals(field.type()) || done.contains(field.id())) return;
    require(visiting.add(field.id()), "计算字段存在循环引用：" + field.label());
    for (String id : field.formula().operands())
      checkDependencies(catalog.get(id), catalog, visiting, done);
    visiting.remove(field.id());
    done.add(field.id());
  }

  /** 输入必须已通过 WorkflowSchema 规范化；返回新映射，不原地修改冻结快照或传入请求。 */
  public static Map<String, Object> calculate(
      List<Field> fields, Map<String, Object> values, boolean required) {
    validate(fields);
    Map<String, Field> catalog = new LinkedHashMap<>();
    fields.forEach(field -> catalog.put(field.id(), field));
    Map<String, Object> result = new LinkedHashMap<>(values);
    Set<String> done = new HashSet<>();
    for (Field field : fields) compute(field, catalog, result, done, required);
    return result;
  }

  private static void compute(
      Field field,
      Map<String, Field> catalog,
      Map<String, Object> values,
      Set<String> done,
      boolean required) {
    if (!"CALCULATED".equals(field.type()) || !done.add(field.id())) return;
    Formula formula = field.formula();
    for (String id : formula.operands()) compute(catalog.get(id), catalog, values, done, required);
    BigDecimal result = null;
    if (formula.operands().stream().allMatch(id -> values.get(id) != null)) {
      if ("DATE_DAYS".equals(formula.operation())) {
        List<?> range = (List<?>) values.get(formula.operands().getFirst());
        result =
            BigDecimal.valueOf(
                ChronoUnit.DAYS.between(
                        LocalDate.parse(range.get(0).toString()),
                        LocalDate.parse(range.get(1).toString()))
                    + 1);
      } else if ("DETAIL_SUM".equals(formula.operation())) {
        result = BigDecimal.ZERO;
        for (Object raw : (List<?>) values.get(formula.operands().getFirst())) {
          Object cell = ((Map<?, ?>) raw).get(formula.column());
          if (cell == null) {
            result = null;
            break;
          }
          result = result.add(new BigDecimal(cell.toString()));
        }
      } else {
        List<BigDecimal> numbers =
            formula.operands().stream()
                .map(id -> new BigDecimal(values.get(id).toString()))
                .toList();
        result =
            switch (formula.operation()) {
              case "SUM" -> numbers.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
              case "SUBTRACT" -> numbers.get(0).subtract(numbers.get(1));
              case "MULTIPLY" -> numbers.stream().reduce(BigDecimal.ONE, BigDecimal::multiply);
              case "DIVIDE" -> {
                if (numbers.get(1).signum() == 0) {
                  require(!required, field.label() + "除数不能为 0");
                  yield null;
                }
                yield numbers.get(0).divide(numbers.get(1), formula.scale(), RoundingMode.HALF_UP);
              }
              default -> throw new BusinessException("计算方式无效");
            };
      }
    }
    require(
        !required || !Boolean.TRUE.equals(field.required()) || result != null,
        field.label() + "的计算来源尚未填写完整");
    if (result != null) {
      result = result.setScale(formula.scale(), RoundingMode.HALF_UP);
      require(
          result.precision() <= 18 && result.abs().compareTo(LIMIT) <= 0,
          field.label() + "计算结果超出允许精度或大小");
      require(
          (field.min() == null || result.compareTo(field.min()) >= 0)
              && (field.max() == null || result.compareTo(field.max()) <= 0),
          field.label() + "计算结果超出允许范围");
    }
    values.put(field.id(), result);
  }

  private static void require(boolean valid, String message) {
    if (!valid) throw new BusinessException(message);
  }
}
