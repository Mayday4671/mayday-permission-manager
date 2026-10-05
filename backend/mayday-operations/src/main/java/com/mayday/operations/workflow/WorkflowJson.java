package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 同一 JSON 编码器服务流程版本、表单、人员解析快照；不允许反序列化为任意 Java 类。 */
@Component
public class WorkflowJson {
  // 运行快照必须保留十进制精度和 scale；否则 500.00 回读成 Double 500.0 会改变包含条件与计算。
  // 只配置本模块私有 mapper，整数 ID 仍使用 Jackson 原有整数类型，不改变全局 JSON 契约。
  private final JsonMapper mapper =
      JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

  /** 只序列化服务已校验的模型和快照，不启用类型名等多态反序列化元数据。 */
  public String write(Object value) {
    return mapper.writeValueAsString(value);
  }

  /** 快照损坏时给出业务错误，不能悄悄退回新草稿并改变历史审批规则。 */
  public WorkflowSchema.Spec spec(String json) {
    try {
      return mapper.readValue(json, WorkflowSchema.Spec.class);
    } catch (Exception e) {
      throw new BusinessException("流程模型无法读取，请联系管理员");
    }
  }

  /** 表单值保持固定的 Map 类型，由 WorkflowSchema 按字段契约二次校验。 */
  public Map<String, Object> form(String json) {
    return json == null
        ? new LinkedHashMap<>()
        : mapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {});
  }

  /** 解析提交时冻结的节点人员列表；角色变化不自动改写已有任务归属。 */
  public Map<String, List<Long>> assignees(String json) {
    return json == null
        ? new LinkedHashMap<>()
        : mapper.readValue(json, new TypeReference<LinkedHashMap<String, List<Long>>>() {});
  }

  /** 执行快照只由服务器生成；损坏时拒绝继续，不能重新创建整个并行组造成重复待办。 */
  public WorkflowExecutionState execution(String json) {
    if (json == null) return null;
    try {
      var state = mapper.readValue(json, WorkflowExecutionState.class);
      state.validate();
      return state;
    } catch (Exception error) {
      throw new BusinessException("审批执行快照无法读取，请联系管理员");
    }
  }
}
