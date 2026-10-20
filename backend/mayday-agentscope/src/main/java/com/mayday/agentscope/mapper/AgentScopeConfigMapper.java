package com.mayday.agentscope.mapper;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 智能助手单例配置表（sys_agentscope_config）的 SQL 收口；密钥密文由服务层加解密。 */
@Mapper
public interface AgentScopeConfigMapper {
  /** 读取单例配置行；空结果代表尚未在后台保存。 */
  default List<Row> selectStored() {
    return Db.selectListBySql(
        "select api_key_cipher, model, request_timeout_seconds, max_message_length,"
            + " max_context_messages, system_prompt from sys_agentscope_config where id = 1");
  }

  /** 保存单例配置；重复保存整体覆盖。 */
  default void upsert(
      String apiKeyCipher,
      String model,
      int requestTimeoutSeconds,
      int maxMessageLength,
      int maxContextMessages,
      String systemPrompt,
      Long updatedBy) {
    Db.updateBySql(
        "insert into sys_agentscope_config "
            + "(id, api_key_cipher, model, request_timeout_seconds, max_message_length, "
            + "max_context_messages, system_prompt, updated_by, created_at, updated_at) "
            + "values (1, ?, ?, ?, ?, ?, ?, ?, now(6), now(6)) "
            + "on duplicate key update api_key_cipher = values(api_key_cipher), "
            + "model = values(model), request_timeout_seconds = values(request_timeout_seconds), "
            + "max_message_length = values(max_message_length), "
            + "max_context_messages = values(max_context_messages), "
            + "system_prompt = values(system_prompt), updated_by = values(updated_by), "
            + "updated_at = now(6)",
        apiKeyCipher,
        model,
        requestTimeoutSeconds,
        maxMessageLength,
        maxContextMessages,
        systemPrompt,
        updatedBy);
  }
}
