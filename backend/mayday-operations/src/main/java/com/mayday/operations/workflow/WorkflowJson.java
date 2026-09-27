package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import java.util.*;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** 同一 JSON 编码器服务流程版本、表单、人员解析快照；不允许反序列化为任意 Java 类。 */
@Component
public class WorkflowJson {
  private final JsonMapper mapper = JsonMapper.builder().build();

  public String write(Object value) {
    return mapper.writeValueAsString(value);
  }

  public WorkflowSchema.Spec spec(String json) {
    try {
      return mapper.readValue(json, WorkflowSchema.Spec.class);
    } catch (Exception e) {
      throw new BusinessException("流程模型无法读取，请联系管理员");
    }
  }

  public Map<String, Object> form(String json) {
    return json == null
        ? new LinkedHashMap<>()
        : mapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {});
  }

  public Map<String, List<Long>> assignees(String json) {
    return json == null
        ? new LinkedHashMap<>()
        : mapper.readValue(json, new TypeReference<LinkedHashMap<String, List<Long>>>() {});
  }
}
