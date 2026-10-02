/** 清理辅助函数只对隔离验收创建的精确文件 ID 操作，等待元信息实际消失而不误读下载失败。 */
import test from "node:test";
import assert from "node:assert/strict";
import { purgeTestFiles } from "./support/files-cleanup.mjs";

test("文件清理拒绝日常环境和非本次 API 地址", async () => {
  const original = {
    project: process.env.API_TEST_COMPOSE_PROJECT,
    database: process.env.API_TEST_DATABASE,
    base: process.env.API_BASE,
  };
  try {
    delete process.env.API_TEST_COMPOSE_PROJECT;
    await assert.rejects(
      purgeTestFiles("http://localhost/api", "dummy", [12]),
      /独立验收/,
    );
    process.env.API_TEST_COMPOSE_PROJECT = "mayday-check-20261002-abcdef";
    process.env.API_TEST_DATABASE = "fresh-db";
    process.env.API_BASE = "http://localhost:18091/api";
    await assert.rejects(
      purgeTestFiles("http://localhost:18080/api", "dummy", [12]),
      /API 地址/,
    );
    await assert.rejects(
      purgeTestFiles(process.env.API_BASE, "dummy", [-1]),
      assert.AssertionError,
    );
  } finally {
    restore(original);
  }
});

test("文件清理只回收和清理登记的 ID，并等待元信息不存在", async () => {
  const original = {
    project: process.env.API_TEST_COMPOSE_PROJECT,
    database: process.env.API_TEST_DATABASE,
    base: process.env.API_BASE,
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  let polls = 0;
  try {
    process.env.API_TEST_COMPOSE_PROJECT = "mayday-check-20261002-abcdef";
    process.env.API_TEST_DATABASE = "fresh-db";
    process.env.API_BASE = "http://localhost:18091/api";
    globalThis.fetch = async (url, options) => {
      calls.push({
        url,
        method: options.method,
        data: options.body && JSON.parse(options.body),
      });
      if (options.method === "GET") {
        polls++;
        if (polls > 2)
          return Response.json(
            { success: false, data: null, message: "文件不存在" },
            { status: 400 },
          );
        return Response.json({
          success: true,
          data: { id: 12, purgeRequestedAt: polls === 1 ? null : "pending" },
        });
      }
      return Response.json({ success: true, data: null });
    };
    await purgeTestFiles(process.env.API_BASE, "dummy", [12, 12]);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "DELETE", "POST", "GET", "GET"],
    );
    assert.deepEqual(calls[2].data, { action: "PURGE", ids: [12] });
    assert(
      calls.every((call) => !call.url.includes("deleted=true")),
      "不要遍历其他用户的回收记录",
    );
    assert(
      calls
        .filter((call) => call.method !== "POST")
        .every((call) => call.url.endsWith("/12")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    restore(original);
  }
});

/** 恢复环境，避免辅助测试改变后续真实 API 回归测试的隔离目标。 */
function restore(original) {
  for (const [name, value] of Object.entries({
    API_TEST_COMPOSE_PROJECT: original.project,
    API_TEST_DATABASE: original.database,
    API_BASE: original.base,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
