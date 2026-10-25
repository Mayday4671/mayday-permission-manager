import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";

/** Channel browsing must fetch only visible thumbnails, never original media. */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "SVGElement",
  "ShadowRoot",
  "Node",
  "MutationObserver",
  "localStorage",
  "sessionStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let observerCallback: IntersectionObserverCallback | undefined;
globalThis.IntersectionObserver = class {
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;
const React = await import("react");
const { render, screen, cleanup, fireEvent, waitFor, act } =
  await import("@testing-library/react");
const { TelegramChannelMediaCard } =
  await import("../src/pages/telegram/TelegramChannelMediaCard");
const { tokenStore } = await import("../src/lib/api");
const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const media = {
  kind: "PHOTO",
  fileName: null,
  size: 9000000,
  width: 1920,
  height: 1080,
  durationSeconds: 0,
  hasThumbnail: true,
};
function visible() {
  act(() =>
    observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
}
function card(value = media, onOpen = () => {}) {
  return (
    <TelegramChannelMediaCard
      chatId="-1001"
      messageId="20"
      media={value}
      disabled={false}
      onOpen={onOpen}
    />
  );
}
function pixels() {
  return new Response(new Blob(["image"], { type: "image/jpeg" }));
}
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  observerCallback = undefined;
  sessionStorage.clear();
});
after(() => dom.window.close());

test("loads visible thumbnails with authorization and releases pixels on unmount", async () => {
  tokenStore.set("test-session");
  const calls: string[] = [];
  const released: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer test-session",
    );
    assert.equal(init?.cache, "no-store");
    return pixels();
  };
  URL.createObjectURL = () => "blob:thumbnail";
  URL.revokeObjectURL = (url) => released.push(url);
  let opened = 0;
  const mounted = render(card(media, () => opened++));
  assert.equal(calls.length, 0);
  visible();
  await screen.findByRole("img", { name: "频道图片" });
  assert.deepEqual(calls, [
    "/api/telegram/channels/-1001/messages/20/thumbnail",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "查看图片" }));
  assert.equal(opened, 1);
  assert.equal(calls.length, 1);
  mounted.unmount();
  assert.deepEqual(released, ["blob:thumbnail"]);
});

test("failed thumbnails offer a retry that loads the image", async () => {
  let count = 0;
  globalThis.fetch = async () =>
    ++count === 1 ? new Response(null, { status: 503 }) : pixels();
  URL.createObjectURL = () => "blob:retried";
  URL.revokeObjectURL = () => {};
  render(card());
  visible();
  fireEvent.click(await screen.findByRole("button", { name: /重试缩略图/ }));
  await screen.findByRole("img", { name: "频道图片" });
  assert.equal(count, 2);
  assert.equal(screen.queryByText("缩略图加载失败"), null);
});

test("switching to a document clears previous pixels and never downloads it", async () => {
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return pixels();
  };
  URL.createObjectURL = () => "blob:previous";
  URL.revokeObjectURL = () => {};
  const mounted = render(card());
  visible();
  await screen.findByRole("img", { name: "频道图片" });
  mounted.rerender(card({ ...media, kind: "DOCUMENT", hasThumbnail: false }));
  await waitFor(() =>
    assert.equal(screen.queryByRole("img", { name: "频道图片" }), null),
  );
  assert.equal(count, 1);
  assert.ok(screen.getByRole("button", { name: "预览附件" }));
});

test("leaving the page aborts an in-flight thumbnail request", async () => {
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  };
  const mounted = render(card());
  visible();
  await waitFor(() => assert.ok(signal));
  mounted.unmount();
  assert.equal(signal?.aborted, true);
});
