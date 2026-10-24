import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";

/** Regression for queued/failed message reads and the private image/video player boundaries. */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLBodyElement",
  "HTMLHtmlElement",
  "Element",
  "SVGElement",
  "ShadowRoot",
  "Node",
  "MutationObserver",
  "localStorage",
  "sessionStorage",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () =>
  ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }) as any;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;
const React = await import("react");
const { render, screen, cleanup, fireEvent, waitFor, act } =
  await import("@testing-library/react");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { TelegramArchiveBrowser } =
  await import("../src/pages/telegram/TelegramArchiveBrowser");
const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let client;
const response = (data) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "Content-Type": "application/json" },
  });
function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <TelegramArchiveBrowser mediaId={7} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});
after(() => dom.window.close());
test("archive entry failure has an actionable retry and no permanent loading state", async () => {
  let attempts = 0;
  const revoked = [];
  URL.createObjectURL = () => "blob:archive-entry";
  URL.revokeObjectURL = (u) => revoked.push(u);
  globalThis.fetch = async (input) => {
    if (String(input).includes("archive-entries"))
      return response({
        items: [
          {
            name: "note.txt",
            size: 3,
            encrypted: false,
            withinExtractionLimit: true,
          },
        ],
        total: 1,
        page: 1,
        size: 50,
      });
    attempts++;
    return attempts === 1
      ? new Response("", { status: 403 })
      : new Response("abc");
  };
  mount();
  fireEvent.click(screen.getByRole("button", { name: "浏览压缩包" }));
  fireEvent.click(await screen.findByRole("button", { name: "预览 / 提取" }));
  await screen.findByText("无法读取所选条目，请检查文件状态和读取权限");
  assert.equal(screen.queryByText("正在按需读取所选条目…"), null);
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  assert.equal(
    (await screen.findByRole("link", { name: "下载所选文件" })).getAttribute(
      "href",
    ),
    "blob:archive-entry",
  );
  assert.equal(attempts, 2);
  cleanup();
  assert.deepEqual(revoked, ["blob:archive-entry"]);
});
test("archive truncated bytes do not become a download link", async () => {
  let allocated = false;
  URL.createObjectURL = () => {
    allocated = true;
    return "blob:invalid";
  };
  globalThis.fetch = async (input) =>
    String(input).includes("archive-entries")
      ? response({
          items: [
            {
              name: "note.txt",
              size: 10,
              encrypted: false,
              withinExtractionLimit: true,
            },
          ],
          total: 1,
          page: 1,
          size: 50,
        })
      : new Response("abc");
  mount();
  fireEvent.click(screen.getByRole("button", { name: "浏览压缩包" }));
  fireEvent.click(await screen.findByRole("button", { name: "预览 / 提取" }));
  await screen.findByText("条目内容不完整，请重试");
  assert.equal(allocated, false);
  assert.equal(screen.queryByRole("link", { name: "下载所选文件" }), null);
});
