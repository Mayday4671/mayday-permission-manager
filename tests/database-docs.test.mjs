import assert from "node:assert/strict";
import test from "node:test";
import { documentedSchema } from "../scripts/database-docs.mjs";

/** Confirms the schema reader handles both normal MySQL tables and AgentScope's provider DDL. */
test("documents all base tables including the AgentScope JDBC state and configuration", () => {
  const schema = documentedSchema();
  const agentState = schema.ai_agent_state;
  const agentConfiguration = schema.sys_agentscope_config;
  const telegramAccount = schema.biz_telegram_account;
  const telegramCollectionTask = schema.biz_telegram_collection_task;
  const telegramCollectionMessage = schema.biz_telegram_collection_message;
  const telegramMedia = schema.biz_telegram_media;

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
  assert.ok(
    telegramAccount,
    "the Telegram account table must be parsed even when CREATE TABLE uses a line break before its opening parenthesis",
  );
  assert.equal(Object.keys(telegramAccount.columns).length, 10);
  assert.equal(Object.keys(schema).length, 77);
  assert.equal(
    Object.values(schema).reduce(
      (count, table) => count + Object.keys(table.columns).length,
      0,
    ),
    781,
  );
  assert.equal(Object.keys(telegramCollectionTask.columns).length, 30);
  assert.equal(
    telegramCollectionTask.columns.source_title,
    "TDLib 验证的采集来源名称；频道来源为频道名，消息链接来源为空",
  );
  assert.match(telegramCollectionTask.columns.from_date, /包含式最早采集日期/);
  assert.match(telegramCollectionTask.columns.to_date, /包含式最晚采集日期/);
  assert.match(telegramCollectionTask.columns.scanned_messages, /上限 5000/);
  assert.match(telegramCollectionTask.columns.tracking_enabled, /自动加入频道/);
  assert.match(
    telegramCollectionTask.columns.live_cursor_message_id,
    /分开保存/,
  );
  assert.match(telegramCollectionTask.columns.live_scanned_messages, /硬上限/);
  assert.equal(
    telegramCollectionTask.columns.download_images,
    "是否允许服务端按任务策略下载图片二进制；默认关闭",
  );
  assert.equal(
    telegramCollectionTask.columns.download_videos,
    "是否允许服务端按任务策略下载视频二进制；默认关闭",
  );
  assert.equal(
    telegramCollectionTask.columns.download_documents,
    "是否允许服务端按任务策略下载文件二进制；默认关闭",
  );
  assert.equal(Object.keys(telegramCollectionMessage.columns).length, 19);
  assert.equal(Object.keys(telegramMedia.columns).length, 25);
  assert.match(telegramCollectionTask.columns.lease_owner, /租约/);
  assert.match(telegramCollectionMessage.columns.can_be_saved, /允许保存/);
  assert.match(telegramMedia.columns.storage_key, /随机对象键/);
  assert.match(telegramMedia.columns.stream_ticket_hash, /SHA-256/);
  assert.match(telegramMedia.columns.status, /EXPIRED/);
});
