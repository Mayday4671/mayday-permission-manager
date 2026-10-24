/** Telegram 真实接口验收；仅在隔离 MySQL 验证栈中创建并清理临时采集任务。 */
import test from "node:test";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "./support/captcha.mjs";
import { isolatedSql } from "./support/isolated-compose.mjs";

const base = process.env.API_BASE ?? "http://127.0.0.1:18080/api";

/** Executes one local API call and checks both HTTP and platform response status. */
async function request(
  path,
  token,
  { method = "GET", body, expectedStatus = 200 } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${method} ${path}: ${result.message}`,
  );
  return result;
}

test("Telegram 模块状态、权限、分页与无会话任务可控", async (t) => {
  assert.ok(
    process.env.API_TEST_COMPOSE_PROJECT,
    "Telegram 真实接口验收只能连接 scripts/verify-baseline.mjs 创建的隔离数据库",
  );

  const admin = await loginWithCaptcha(
    base,
    "admin",
    process.env.ADMIN_PASSWORD,
  );
  const token = admin.token;
  const status = await request("/telegram/status", token);

  assert.equal(status.data.enabled, true);
  assert.equal(status.data.connected, false);
  assert.equal(status.data.accountConfigured, false);
  assert.equal(status.data.credentialsConfigured, false);
  assert.equal(status.data.encryptionKeyConfigured, false);
  assert.equal(status.data.state, "NOT_CONNECTED");
  assert.equal("apiHash" in status.data, false);
  assert.equal("sessionDirectory" in status.data, false);

  const initialConfiguration = await request("/telegram/configuration", token);
  assert.equal(initialConfiguration.data.encryptionAvailable, true);
  assert.equal("apiHash" in initialConfiguration.data, false);
  assert.equal("sessionEncryptionKey" in initialConfiguration.data, false);

  const invalid = await request("/telegram/collections", token, {
    method: "POST",
    body: {
      messageLink: "https://example.org/channel/1",
      maxMessages: 10,
      downloadImages: false,
      downloadVideos: false,
      downloadDocuments: false,
    },
    expectedStatus: 400,
  });
  assert.equal(invalid.success, false);

  const created = await request("/telegram/collections", token, {
    method: "POST",
    body: {
      messageLink: "https://t.me/mayday_acceptance/1",
      maxMessages: 10,
      downloadImages: true,
      downloadVideos: false,
      downloadDocuments: false,
    },
  });
  const taskId = created.data.id;
  assert.equal(created.data.status, "QUEUED");

  const missingMedia = await request(
    "/telegram/media/9223372036854775807/stream-ticket",
    token,
    {
      method: "POST",
      expectedStatus: 404,
    },
  );
  assert.equal(missingMedia.success, false);

  const missingArchive = await request(
    "/telegram/media/9223372036854775807/archive-entries?page=1&size=20",
    token,
    { expectedStatus: 404 },
  );
  assert.equal(missingArchive.success, false);
  const activeDelete = await request(`/telegram/collections/${taskId}`, token, {
    method: "DELETE",
    expectedStatus: 400,
  });
  assert.equal(activeDelete.success, false);

  t.after(async () => {
    const cancelled = await request(
      `/telegram/collections/${taskId}/cancel`,
      token,
      {
        method: "POST",
        expectedStatus: 200,
      },
    );
    assert.equal(cancelled.data.status, "CANCELLED");
    const deleted = await request(`/telegram/collections/${taskId}`, token, {
      method: "DELETE",
      expectedStatus: 200,
    });
    assert.equal(deleted.success, true);
  });

  const tasks = await request("/telegram/collections?page=1&size=10", token);
  assert.ok(tasks.data.items.some((item) => item.id === taskId));
  assert.ok(tasks.data.total >= 1);

  const messages = await request(
    `/telegram/collections/${taskId}/messages?page=1&size=10`,
    token,
  );
  assert.deepEqual(messages.data.items, []);
  assert.equal(messages.data.page, 1);

  const paused = await request(`/telegram/collections/${taskId}/pause`, token, {
    method: "POST",
  });
  assert.equal(paused.data.status, "PAUSED");

  const resumed = await request(
    `/telegram/collections/${taskId}/resume`,
    token,
    { method: "POST" },
  );
  assert.equal(resumed.data.status, "QUEUED");

  // A synthetic, non-network channel fixture exercises the endpoint contract;
  // its future checkpoint prevents the scheduler from opening any Telegram client.
  const trackingTaskId = Number(
    isolatedSql(
      `INSERT INTO biz_telegram_collection_task
        (created_at, updated_at, version, owner_id, department_id, message_link, source_title,
         from_date, to_date, scanned_messages, chat_id, cursor_message_id, start_message_id,
         max_messages, collected_messages, status, download_images, download_videos,
         download_documents, status_message, lease_owner, lease_expires_at, tracking_enabled,
         live_cursor_message_id, live_scanned_messages, live_checked_at, live_status_message,
         live_lease_owner, live_lease_expires_at)
       SELECT CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6), 0, id, department_id, NULL,
         '隔离验收频道', NULL, NULL, 0, '-1001234567890', '0', NULL, 10, 0, 'COMPLETED',
         0, 0, 0, '仅用于验证定期追赶 API', NULL, NULL, 0, '0', 0,
         DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 1 DAY), NULL, NULL, NULL
       FROM sys_user WHERE username = 'admin';
       SELECT LAST_INSERT_ID();`,
      { raw: true },
    ).trim(),
  );
  assert.ok(Number.isSafeInteger(trackingTaskId) && trackingTaskId > 0);
  t.after(() => {
    isolatedSql(
      `DELETE FROM biz_telegram_collection_task WHERE id = ${trackingTaskId};`,
    );
  });
  const trackingEnabled = await request(
    `/telegram/collections/${trackingTaskId}/tracking`,
    token,
    {
      method: "POST",
      body: { enabled: true },
    },
  );
  assert.equal(trackingEnabled.data.trackingEnabled, true);
  assert.match(trackingEnabled.data.liveStatusMessage, /不会自动加入频道/);

  const trackingDisabled = await request(
    `/telegram/collections/${trackingTaskId}/tracking`,
    token,
    {
      method: "POST",
      body: { enabled: false },
    },
  );
  assert.equal(trackingDisabled.data.trackingEnabled, false);
  assert.match(trackingDisabled.data.liveStatusMessage, /已停止/);

  // Dummy credentials verify page configuration persistence and ciphertext shape;
  // this isolated stack never connects a Telegram client or contacts Telegram.
  const savedConfiguration = await request("/telegram/configuration", token, {
    method: "PUT",
    body: {
      apiId: "123456789",
      apiHash: "isolated-api-hash-test-value",
      proxyEnabled: true,
      proxyType: "socks5",
      proxyHost: "127.0.0.1",
      proxyPort: 1080,
      proxyUsername: "isolated-user",
      proxyPassword: "isolated-proxy-password",
      proxySecret: "",
    },
  });
  assert.equal(savedConfiguration.data.apiId, "123456789");
  assert.equal(savedConfiguration.data.apiHashConfigured, true);
  assert.equal(savedConfiguration.data.sessionKeyConfigured, true);
  assert.equal(savedConfiguration.data.proxyPasswordConfigured, true);
  assert.equal(savedConfiguration.data.databaseOverride, true);
  assert.equal("apiHash" in savedConfiguration.data, false);
  assert.equal("sessionEncryptionKey" in savedConfiguration.data, false);

  const encryptedConfiguration = isolatedSql(
    `SELECT LEFT(api_hash_cipher, 3), LEFT(session_encryption_key_cipher, 3),
            LEFT(proxy_password_cipher, 3),
            LOCATE('isolated-api-hash-test-value', api_hash_cipher),
            LOCATE('isolated-proxy-password', proxy_password_cipher)
       FROM sys_telegram_config WHERE id = 1;`,
    { raw: true },
  )
    .trim()
    .split("\t");
  assert.deepEqual(encryptedConfiguration, ["v1.", "v1.", "v1.", "0", "0"]);

  const reloadedConfiguration = await request("/telegram/configuration", token);
  assert.equal(reloadedConfiguration.data.apiId, "123456789");
  assert.equal(reloadedConfiguration.data.apiHashConfigured, true);
  assert.equal(reloadedConfiguration.data.proxyPasswordConfigured, true);
  assert.equal("apiHash" in reloadedConfiguration.data, false);
});
