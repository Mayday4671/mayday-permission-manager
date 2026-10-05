package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;

/**
 * 仅审批表单 values 使用的十进制解码器。旧客户端发送 JSON 数字时直接从原始数字 token 读取 BigDecimal，不能先经过 Double
 * 再转换；新客户端的十进制字符串仍交由字段契约校验。 整数保持 Jackson 的 Integer/Long 类型，人员、部门、附件编号不会因金额精度要求变成字符串。
 */
public final class WorkflowFormValuesDeserializer extends ValueDeserializer<Map<String, Object>> {
  private static final int MAX_DEPTH = 12;
  private static final int MAX_VALUES = 8192;

  /** 明细表也经相同的无类型 Map/List 解析路径，所有嵌套小数均保留原始有效位和 scale。 */
  @Override
  public Map<String, Object> deserialize(JsonParser parser, DeserializationContext context) {
    if (parser.currentToken() != JsonToken.START_OBJECT) throw new BusinessException("审批表单值必须为对象");
    return object(parser, 0, new int[] {0});
  }

  /** 使用 Spring 已创建的 parser，保留其字符串/数字长度等读取约束；额外限制表单嵌套与元素总数。 */
  private Object value(JsonParser parser, int depth, int[] count) {
    if (depth > MAX_DEPTH || ++count[0] > MAX_VALUES) throw new BusinessException("审批表单结构超过允许范围");
    var token = parser.currentToken();
    if (token == null) throw new BusinessException("审批表单值不完整");
    return switch (token) {
      case START_OBJECT -> object(parser, depth, count);
      case START_ARRAY -> {
        var items = new ArrayList<Object>();
        while (parser.nextToken() != JsonToken.END_ARRAY)
          items.add(value(parser, depth + 1, count));
        yield items;
      }
      case VALUE_NUMBER_FLOAT -> parser.getDecimalValue();
      case VALUE_NUMBER_INT -> parser.getNumberValue();
      case VALUE_STRING -> parser.getString();
      case VALUE_TRUE -> true;
      case VALUE_FALSE -> false;
      case VALUE_NULL -> null;
      default -> throw new BusinessException("审批表单值格式无效");
    };
  }

  private Map<String, Object> object(JsonParser parser, int depth, int[] count) {
    Map<String, Object> result = new LinkedHashMap<>();
    while (parser.nextToken() != JsonToken.END_OBJECT) {
      if (parser.currentToken() != JsonToken.PROPERTY_NAME)
        throw new BusinessException("审批表单值格式无效");
      String key = parser.currentName();
      parser.nextToken();
      result.put(key, value(parser, depth + 1, count));
    }
    return result;
  }
}
