package com.mayday.operations.workflow;

import java.math.BigDecimal;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueSerializer;

/**
 * 仅用于审批字段 min/max 的局部编码器。浏览器不能精确解析 18 位十进制 JSON 数字，故上下限 采用字符串；不注册为全局 Jackson
 * serializer，也不改变其他业务数值或关联 ID 的网络类型。
 */
public final class WorkflowDecimalSerializer extends ValueSerializer<BigDecimal> {
  /** 普通业务范围使用非科学计数表示；负 scale 保留旧指数表示，极端正 scale 不展开超长字符串。 */
  @Override
  public void serialize(BigDecimal value, JsonGenerator generator, SerializationContext context) {
    generator.writeString(
        value.scale() >= 0 && value.scale() <= 64 ? value.toPlainString() : value.toString());
  }
}
