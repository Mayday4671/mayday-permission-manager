package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 审批表单的精确网络表示。执行、持久化、条件判断及父子映射继续使用 BigDecimal；仅在字段权限 已裁剪后，依据冻结字段类型将 NUMBER/MONEY/CALCULATED
 * 编为十进制字符串。关联 ID、文件列表、 文本和非表单业务数字不参与转换，不能通过全局数字序列化改变其他模块契约。
 */
public final class WorkflowDecimalValues {
  private static final Set<String> DECIMAL_TYPES = Set.of("NUMBER", "MONEY", "CALCULATED");

  private WorkflowDecimalValues() {}

  /** 当前值与提交历史共用此边界；只转换已经存在的字段，不增加任何未授权值。 */
  public static Map<String, Object> view(List<Field> fields, Map<String, Object> values) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Field field : fields)
      if (values.containsKey(field.id()))
        result.put(field.id(), value(field, values.get(field.id())));
    return result;
  }

  /** 变更记录的 before/after 独立按原字段转换，保留 null 与明细结构，不混入人员修复审计。 */
  public static Map<String, Object> changes(List<Field> fields, Map<String, Object> changes) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Field field : fields) {
      Object change = changes.get(field.id());
      if (!(change instanceof Map<?, ?> sides)) continue;
      Map<String, Object> converted = new LinkedHashMap<>();
      for (String side : List.of("before", "after"))
        if (sides.containsKey(side)) converted.put(side, value(field, sides.get(side)));
      result.put(field.id(), converted);
    }
    return result;
  }

  private static Object value(Field field, Object raw) {
    if (raw == null) return null;
    if (DECIMAL_TYPES.contains(field.type())) {
      try {
        // 兼容旧 JSON 的整数和字符串；调用者仍必须先通过实例访问与字段权限校验。
        BigDecimal decimal =
            raw instanceof BigDecimal number ? number : new BigDecimal(raw.toString());
        // 负 scale 是旧合法数值的表示契约，例如 1e3 持久化为 1E+3。展开为 1000 后无改重存
        // 会把 CONTAINS("000") 从 false 改成 true，因此指数表示必须与执行值一起保留。
        return decimal.scale() < 0 ? decimal.toString() : decimal.toPlainString();
      } catch (NumberFormatException error) {
        throw new BusinessException("审批数值快照无法读取，请联系管理员");
      }
    }
    if ("DETAILS".equals(field.type()) && raw instanceof List<?> rows) {
      List<Map<String, Object>> result = new ArrayList<>();
      for (Object row : rows) {
        if (!(row instanceof Map<?, ?> columns)) throw new BusinessException("审批明细快照无法读取，请联系管理员");
        Map<String, Object> cells = new LinkedHashMap<>();
        for (Field column : field.columns())
          if (columns.containsKey(column.id()))
            cells.put(column.id(), value(column, columns.get(column.id())));
        result.add(cells);
      }
      return result;
    }
    return raw;
  }
}
