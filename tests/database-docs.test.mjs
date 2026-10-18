import assert from "node:assert/strict";
import test from "node:test";
import { documentedSchema } from "../scripts/database-docs.mjs";

/** Confirms the schema reader handles both normal MySQL tables and AgentScope's provider DDL. */
test("documents all base tables including the AgentScope JDBC state and configuration", () => {
  const schema = documentedSchema();
  const agentState = schema.ai_agent_state;
  const agentConfiguration = schema.sys_agentscope_config;

  assert.ok(
    agentState,
    "the JDBC state table must remain in the unified schema inventory",
  );
  assert.equal(
    agentState.comment,
    "AgentScope Java 官方 JDBC 会话状态；持久化到 MySQL 以支持重启和多实例",
  );
  assert.ok(
    agentConfiguration,
    "the model configuration table must remain in the unified schema inventory",
  );
  assert.equal(
    agentConfiguration.columns.api_key_cipher,
    "DashScope API 密钥 AES-256-GCM 密文；随机 IV 与认证标签包含在密文中，绝不保存明文",
  );
});
