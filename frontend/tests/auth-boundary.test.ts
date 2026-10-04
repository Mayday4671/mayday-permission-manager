import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError, tokenStore } from "../src/lib/api";

const values = new Map<string, string>();
const events: string[] = [];
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: { origin: "http://localhost" },
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  },
});

test("旧会话慢请求返回401不能清除已重新登录的新令牌", async () => {
  let complete!: (response: Response) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    });
  tokenStore.set("old-session");
  const pending = api("/system/users");
  tokenStore.set("new-session");
  complete(
    Response.json({ success: false, message: "旧会话已过期" }, { status: 401 }),
  );
  await assert.rejects(pending, ApiError);
  assert.equal(tokenStore.get(), "new-session");
  assert.equal(events.length, 0);
});

test("当前会话确实失效时清令牌并发送统一失效事件", async () => {
  globalThis.fetch = async () =>
    Response.json({ success: false, message: "当前会话失效" }, { status: 401 });
  tokenStore.set("expired-session");
  await assert.rejects(api("/system/users"), ApiError);
  assert.equal(tokenStore.get(), null);
  assert.deepEqual(events, ["mayday:unauthorized"]);
});

test("契约客户端同样拒绝旧请求撤销新会话", async () => {
  const { contractClient } = await import("../src/lib/contract-client");
  let complete!: (response: Response) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    });
  tokenStore.set("old-contract-session");
  const pending = contractClient.GET("/api/auth/me");
  // 中间件会异步构建请求，待 fetch 到达后再切换令牌。
  while (!complete) await Promise.resolve();
  tokenStore.set("new-contract-session");
  complete(
    Response.json({ success: false, message: "旧请求无效" }, { status: 401 }),
  );
  await pending;
  assert.equal(tokenStore.get(), "new-contract-session");
  assert.equal(events.length, 1);
});

test("迟到的导出下载401不能注销新会话，当前下载401仍统一失效", async () => {
  const { downloadBulkResult } = await import("../src/lib/bulk-data");
  let complete!: (response: Response) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    });
  const originalEvents = events.length;
  tokenStore.set("old-download-session");
  const pending = downloadBulkResult(1, "users.csv");
  while (!complete) await Promise.resolve();
  tokenStore.set("new-download-session");
  complete(
    Response.json({ success: false, message: "旧请求失效" }, { status: 401 }),
  );
  await assert.rejects(pending, ApiError);
  assert.equal(tokenStore.get(), "new-download-session");
  assert.equal(events.length, originalEvents);
  globalThis.fetch = async () =>
    Response.json({ success: false, message: "当前会话失效" }, { status: 401 });
  await assert.rejects(downloadBulkResult(1, "users.csv"), ApiError);
  assert.equal(tokenStore.get(), null);
  assert.equal(events.length, originalEvents + 1);
});

test("网络边界拒绝格式错误的成功信封，业务错误只接受字符串消息", async () => {
  for (const invalid of [
    null,
    1,
    { success: "true", data: [] },
    { success: true },
  ]) {
    globalThis.fetch = async () => Response.json(invalid);
    await assert.rejects(api("/system/users"), ApiError);
  }
  globalThis.fetch = async () =>
    Response.json(
      { success: false, message: { internal: "实现细节" } },
      { status: 400 },
    );
  await assert.rejects(
    api("/system/users"),
    (error: unknown) =>
      error instanceof ApiError && !error.message.includes("实现细节"),
  );
});

test("服务器故障保留随机定位号，不接受可注入的响应头", async () => {
  const id = "59620f43-3cf7-43c4-93af-95fca3cf16c2";
  globalThis.fetch = async () =>
    Response.json(
      { success: false, message: "服务暂时不可用" },
      { status: 500, headers: { "X-Request-ID": id } },
    );
  await assert.rejects(
    api("/system/users"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.requestId === id &&
      error.message.includes(id),
  );
  globalThis.fetch = async () =>
    Response.json(
      { success: false, message: "服务暂时不可用" },
      { status: 500, headers: { "X-Request-ID": "unexpected-secret-value" } },
    );
  await assert.rejects(
    api("/system/users"),
    (error: unknown) =>
      error instanceof ApiError &&
      !error.requestId &&
      !error.message.includes("unexpected-secret-value"),
  );
});

test("代理拒绝超大文件时仍给出正确上传提示，不能误称服务器未启动", async () => {
  globalThis.fetch = async () =>
    new Response("<html>too large</html>", { status: 413 });
  await assert.rejects(
    api("/operations/files", { method: "POST" }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 413 &&
      error.message.includes("减小文件"),
  );
});

test("生成契约边界与通用请求使用相同的故障定位和上传限制提示", async () => {
  const { unwrapContract } = await import("../src/lib/contract-client");
  const id = "59620f43-3cf7-43c4-93af-95fca3cf16c2";
  assert.throws(
    () =>
      unwrapContract({
        error: { message: "服务暂时不可用" },
        response: new Response(null, {
          status: 500,
          headers: { "X-Request-ID": id },
        }),
      }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.requestId === id &&
      error.message.includes(id),
  );
  assert.throws(
    () => unwrapContract({ response: new Response(null, { status: 413 }) }),
    (error: unknown) =>
      error instanceof ApiError && error.message.includes("减小文件"),
  );
});
