package com.mayday;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.mayday.operations.web.WorkflowController;
import com.mayday.operations.workflow.WorkflowConditions;
import com.mayday.operations.workflow.WorkflowDecimalValues;
import com.mayday.operations.workflow.WorkflowEngine;
import com.mayday.operations.workflow.WorkflowJson;
import com.mayday.operations.workflow.WorkflowSchema;
import com.mayday.operations.workflow.WorkflowSchema.Field;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** 精确十进制贯穿请求 token、持久化及裁剪后的网络视图；关联 ID 不受数字字段字符串契约影响。 */
class WorkflowDecimalTest {
  private final WorkflowJson json = new WorkflowJson();

  private Field field(String id, String type) {
    return new Field(id, id, type, false, 24, null, null, null, null);
  }

  /** 原始 JSON literal 直接读取而不经过 Double，既有整数关联字段继续保持数字。 */
  @Test
  void everyFormRequestDecodesLegacyDecimalTokensExactlyWithoutChangingGlobalMapper() {
    var mapper = JsonMapper.builder().build();
    String source =
        """
        {"values":{"amount":999999999999999.99,
        "quantity":999999999999.123456,"user":9,"files":[11],
        "rows":[{"amount":99999999999999.99}]}}
        """;
    List<Map<String, Object>> values =
        List.of(
            mapper.readValue(source, WorkflowEngine.Submit.class).values(),
            mapper.readValue(source, WorkflowEngine.Edit.class).values(),
            mapper.readValue(source, WorkflowEngine.Action.class).values(),
            mapper.readValue(source, WorkflowController.Simulation.class).values());
    for (var form : values) {
      assertEquals(new BigDecimal("999999999999999.99"), form.get("amount"));
      assertEquals(new BigDecimal("999999999999.123456"), form.get("quantity"));
      assertEquals(9, form.get("user"));
      assertEquals(List.of(11), form.get("files"));
      assertEquals(
          new BigDecimal("99999999999999.99"),
          ((Map<?, ?>) ((List<?>) form.get("rows")).getFirst()).get("amount"));
    }
    assertInstanceOf(
        Double.class,
        ((Map<?, ?>) mapper.readValue(source, Map.class).get("values")).get("amount"),
        "OA 属性级解码不能变更 Spring 或其他业务默认数字类型");
  }

  /** 主表/明细的合法小数最多只有数层；异常递归应在固定深度拒绝，不能依赖 Java 栈容量。 */
  @Test
  void nestedFormPayloadsAreBoundedBeforeFieldValidation() {
    String nested = "{\"leaf\":1}";
    for (int depth = 0; depth < 14; depth++) nested = "{\"nested\":" + nested + "}";
    String source = "{\"values\":" + nested + "}";
    assertThrows(
        RuntimeException.class,
        () -> JsonMapper.builder().build().readValue(source, WorkflowEngine.Submit.class));
    String wide = "{\"values\":{\"items\":[" + "0,".repeat(8192) + "0]}}";
    assertThrows(
        RuntimeException.class,
        () -> JsonMapper.builder().build().readValue(wide, WorkflowEngine.Submit.class));
  }

  /** 同一个提交快照在重启后依然保留 scale，数值 CONTAINS 与模拟使用的原始 BigDecimal 一致。 */
  @Test
  void persistencePreservesExactDecimalScaleAndNestedValues() {
    var source =
        Map.of(
            "total",
            new BigDecimal("500.00"),
            "amount",
            new BigDecimal("999999999999999.99"),
            "rows",
            List.of(Map.of("quantity", new BigDecimal("999999999999.123456"))),
            "files",
            List.of(11));
    var restored = json.form(json.write(source));
    assertEquals(source, restored);
    assertEquals("500.00", restored.get("total").toString());
    assertEquals(List.of(11), restored.get("files"));
  }

  /** 负 scale 不能因网络回读被展开；无修改保存/重提仍采用旧 CONTAINS 表示语义。 */
  @Test
  void negativeScaleNumbersKeepTheirRepresentationThroughRequestsPersistenceAndWireViews() {
    var field = field("exponent", "NUMBER");
    var spec =
        new WorkflowSchema.Spec(List.of(field), List.of(), "", "ALL", Set.of(), false, false, true);
    var rule = new WorkflowSchema.Condition("exponent", "CONTAINS", "000", "matched");
    var mapper = JsonMapper.builder().build();
    for (String payload :
        List.of("{\"values\":{\"exponent\":1e3}}", "{\"values\":{\"exponent\":\"1e3\"}}")) {
      var request = mapper.readValue(payload, WorkflowEngine.Submit.class);
      var values = WorkflowSchema.form(spec, request.values());
      assertEquals(new BigDecimal("1E+3"), values.get("exponent"));
      assertFalse(WorkflowConditions.matches(rule, values));
      var wire = WorkflowDecimalValues.view(spec.fields(), json.form(json.write(values)));
      assertEquals("1E+3", wire.get("exponent"));
      var saved = WorkflowSchema.form(spec, wire);
      assertEquals(values, saved);
      assertFalse(WorkflowConditions.matches(rule, saved));
      assertEquals("1E+3", WorkflowDecimalValues.view(spec.fields(), saved).get("exponent"));
    }
    var bounded =
        new Field(
            "exponent",
            "指数",
            "NUMBER",
            true,
            24,
            new BigDecimal("1E+3"),
            new BigDecimal("1E+4"),
            null,
            null);
    var transport = mapper.readValue(mapper.writeValueAsString(bounded), Map.class);
    assertEquals("1E+3", transport.get("min"));
    assertEquals("1E+4", transport.get("max"));
  }

  /** 仅冻结模型中声明的十进制字段转换；原整数数值也转字符串，而关联 ID/文本不转换。 */
  @Test
  void valuesAndChangesHaveAFieldSpecificExactTransportWithoutInventingHiddenFields() {
    var rows =
        new Field(
            "rows",
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
            List.of(field("amount", "MONEY"), field("label", "TEXT")),
            20);
    var fields =
        List.of(
            field("amount", "MONEY"),
            field("quantity", "NUMBER"),
            field("total", "CALCULATED"),
            rows,
            field("user", "USER"),
            field("files", "FILES"),
            field("kind", "SINGLE"));
    var source =
        Map.<String, Object>of(
            "amount",
            new BigDecimal("999999999999999.99"),
            "quantity",
            7,
            "total",
            new BigDecimal("500.00"),
            "rows",
            List.of(Map.of("amount", new BigDecimal("99999999999999.99"), "label", "12.00")),
            "user",
            9,
            "files",
            List.of(11),
            "kind",
            "0001",
            "hidden",
            new BigDecimal("1.11"));
    var wire = WorkflowDecimalValues.view(fields, source);
    assertEquals("999999999999999.99", wire.get("amount"));
    assertEquals("7", wire.get("quantity"));
    assertEquals("500.00", wire.get("total"));
    assertEquals(
        List.of(Map.of("amount", "99999999999999.99", "label", "12.00")), wire.get("rows"));
    assertEquals(9, wire.get("user"));
    assertEquals(List.of(11), wire.get("files"));
    assertEquals("0001", wire.get("kind"));
    assertEquals(false, wire.containsKey("hidden"));
    var sides = new LinkedHashMap<String, Object>();
    sides.put("before", null);
    sides.put("after", new BigDecimal("999999999999999.99"));
    var changes = WorkflowDecimalValues.changes(fields, Map.of("amount", sides));
    assertEquals(null, ((Map<?, ?>) changes.get("amount")).get("before"));
    assertEquals("999999999999999.99", ((Map<?, ?>) changes.get("amount")).get("after"));
    assertEquals(source.get("amount"), new BigDecimal("999999999999999.99"), "输出转换不修改执行值");
  }

  /** min/max 局部编码为精确字符串；旧数字和新字符串都可读，极端旧指数不被展开为超长文本。 */
  @Test
  void fieldBoundsUseLocalDecimalStringsAndReadOldNumericModels() {
    var mapper = JsonMapper.builder().build();
    var field =
        new Field(
            "amount",
            "金额",
            "MONEY",
            true,
            24,
            new BigDecimal("999999999999999.98"),
            new BigDecimal("999999999999999.99"),
            null,
            null);
    var encoded = mapper.writeValueAsString(field);
    var restored = mapper.readValue(encoded, Field.class);
    var transport = mapper.readValue(encoded, new TypeReference<Map<String, Object>>() {});
    assertEquals("999999999999999.98", transport.get("min"));
    assertEquals("999999999999999.99", transport.get("max"));
    assertEquals(field.min(), restored.min());
    assertEquals(field.max(), restored.max());
    var legacy =
        mapper.readValue(
            "{\"id\":\"amount\",\"label\":\"金额\",\"type\":\"MONEY\",\"min\":999999999999999.98}",
            Field.class);
    assertEquals(field.min(), legacy.min());
    var extreme =
        new Field("amount", "金额", "MONEY", true, 24, null, new BigDecimal("1e100000"), null, null);
    assertEquals(
        "1E+100000", mapper.readValue(mapper.writeValueAsString(extreme), Map.class).get("max"));
  }
}
