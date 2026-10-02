package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** 同一 JSON 编码器服务流程版本、表单、人员解析快照；不允许反序列化为任意 Java 类。 */
@Component
public class WorkflowJson {
  private final JsonMapper mapper = JsonMapper.builder().build();

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
}
