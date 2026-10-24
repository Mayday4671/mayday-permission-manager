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
const { TelegramMessageMediaPreview, TelegramInlineMediaItem } =
  await import("../src/pages/telegram/TelegramMessageMediaPreview");
const { tokenStore } = await import("../src/lib/api");
const { TelegramAttachmentDownload } =
  await import("../src/pages/telegram/TelegramAttachmentDownload");
const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let client: InstanceType<typeof QueryClient>;
const reply = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "Content-Type": "application/json" },
  });
const media = (status = "AVAILABLE", type = "image/jpeg") => ({
  id: 9,
  kind: type.startsWith("image") ? "PHOTO" : "VIDEO",
  fileName: "sample",
  expectedSize: 123,
  actualSize: 123,
  mediaType: type,
  status,
  contentUrl: "/api/telegram/media/9/content",
  failureMessage: null,
});
const row = (attachments = [media()]) => ({
  id: 1,
  canBeSaved: true,
  media: attachments,
});
function mount(element: React.ReactNode) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>{element}</QueryClientProvider>,
  );
}
function modal(onRetry = () => {}) {
  return (
    <TelegramMessageMediaPreview
      taskId={4}
      messageLink="https://t.me/telegram/1"
      onClose={() => {}}
      onRetry={onRetry}
      retrying={false}
    />
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  tokenStore.clear();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});
after(() => dom.window.close());

test("下载图片、视频和普通文件均携带凭证，完整读取后保留正确文件名", async () => {
  tokenStore.set("download-session");
  const saved: string[] = [];
  const originalClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () {
    saved.push(this.download);
  };
  try {
    for (const [type, fileName, expected] of [
      ["image/jpeg", null, "telegram-9.jpg"],
      ["video/mp4", "sample.mp4", "sample.mp4"],
      ["application/pdf", "使用说明.pdf", "使用说明.pdf"],
    ] as const) {
      URL.createObjectURL = (blob) => {
        assert.equal((blob as Blob).size, 6);
        return "blob:download";
      };
      let released = false;
      URL.revokeObjectURL = () => {
        released = true;
      };
      globalThis.fetch = async (_url, options) => {
        assert.equal(
          (options?.headers as any)?.Authorization,
          "Bearer download-session",
        );
        return new Response("sample");
      };
      const view = mount(
        <TelegramAttachmentDownload
          attachment={{ ...media("AVAILABLE", type), fileName, actualSize: 6 }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "下载文件" }));
      await waitFor(() => assert.equal(saved.at(-1), expected));
      await waitFor(() => assert(released), { timeout: 1800 });
      view.unmount();
      client.clear();
    }
  } finally {
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("拒绝下载权限、部分响应和截断文件时不会创建浏览器下载", async () => {
  let saves = 0;
  URL.createObjectURL = () => {
    saves++;
    return "blob:unexpected";
  };
  const view = mount(<TelegramAttachmentDownload attachment={media()} />);
  for (const [response, expected] of [
    [new Response("denied", { status: 403 }), "当前账号没有附件下载权限"],
    [new Response("partial", { status: 206 }), "附件下载失败，请重试"],
    [new Response("short"), "附件内容不完整，请重新下载"],
  ] as const) {
    globalThis.fetch = async () => response;
    fireEvent.click(screen.getByRole("button", { name: "下载文件" }));
    await screen.findByText(expected);
  }
  assert.equal(saves, 0);
  view.unmount();
});

test("取消或关闭预览会中止附件下载，不保存迟到的文件", async () => {
  let signal: AbortSignal | undefined;
  let complete: ((value: Response) => void) | undefined;
  let saves = 0;
  URL.createObjectURL = () => {
    saves++;
    return "blob:unexpected";
  };
  globalThis.fetch = async (_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  };
  const view = mount(
    <TelegramAttachmentDownload attachment={{ ...media(), actualSize: 6 }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "下载文件" }));
  fireEvent.click(await screen.findByRole("button", { name: "取消下载" }));
  assert(signal?.aborted);
  await act(async () => {
    complete?.(new Response("sample"));
  });
  assert.equal(saves, 0);
  fireEvent.click(screen.getByRole("button", { name: "下载文件" }));
  await waitFor(() => assert.equal(signal?.aborted, false));
  view.unmount();
  assert(signal?.aborted);
  await act(async () => {
    complete?.(new Response("sample"));
  });
  assert.equal(saves, 0);
});

test("排队返回空消息页时继续等待，不报告无媒体；失败原因和重试按钮可见", async () => {
  let status = "QUEUED";
  globalThis.fetch = async (url) =>
    reply(
      String(url).includes("/messages?")
        ? { items: [] }
        : { status, statusMessage: "Telegram 未返回链接指定的消息" },
    );
  let retries = 0;
  mount(modal(() => retries++));
  await screen.findByText("正在排队读取原消息…");
  assert.equal(screen.queryByText(/没有图片或视频/), null);
  status = "FAILED";
  await act(() => client.invalidateQueries());
  await screen.findByText("Telegram 未返回链接指定的消息");
  assert.equal(screen.queryByText(/没有图片或视频/), null);
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  assert.equal(retries, 1);
});

test("原消息完成但附件下载中仍展示等待，文件完成后实际加载图片并释放资源", async () => {
  let status = "DOWNLOADING";
  let authenticated = false;
  let revoked = false;
  tokenStore.set("test-session");
  URL.createObjectURL = () => "blob:sample-image";
  URL.revokeObjectURL = (url) => {
    revoked = url === "blob:sample-image";
  };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/content")) {
      authenticated =
        (options?.headers as any)?.Authorization === "Bearer test-session";
      return new Response(new Blob(["test"], { type: "image/jpeg" }));
    }
    return reply(
      String(url).includes("/messages?")
        ? { items: [row([media(status)])] }
        : { status: "COMPLETED" },
    );
  };
  mount(modal());
  await screen.findByText(/正在下载 1 个媒体文件/);
  assert.equal(screen.queryByText(/没有图片或视频/), null);
  status = "AVAILABLE";
  await act(() => client.invalidateQueries());
  const image = await screen.findByAltText("sample");
  assert.equal(image.getAttribute("src"), "blob:sample-image");
  assert.equal(authenticated, true);
  cleanup();
  assert.equal(revoked, true);
});

test("下载失败不伪装成空结果，接口失败可以刷新", async () => {
  globalThis.fetch = async (url) =>
    reply(
      String(url).includes("/messages?")
        ? {
            items: [
              row([
                { ...media("FAILED"), failureMessage: "附件超过单文件上限" },
              ]),
            ],
          }
        : { status: "COMPLETED" },
    );
  mount(modal());
  await screen.findByText("附件超过单文件上限");
  assert.equal(screen.queryByText(/没有图片或视频/), null);
  globalThis.fetch = async () => {
    throw new Error("network offline");
  };
  await act(() => client.invalidateQueries());
  await screen.findByText("预览状态读取失败");
});

test("只有已完成的无附件消息才显示空媒体说明", async () => {
  globalThis.fetch = async (url) =>
    reply(
      String(url).includes("/messages?")
        ? { items: [row([])] }
        : { status: "COMPLETED" },
    );
  mount(modal());
  await screen.findByText("这条原消息没有可下载的附件");
});

test("原视频使用受权播放票据，浏览器解码失败时可发起兼容格式转换", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(`${options?.method ?? "GET"} ${url}`);
    return reply(
      String(url).endsWith("/stream-ticket")
        ? { url: "/api/telegram/media/9/stream?ticket=test" }
        : { status: "PROCESSING", statusMessage: "正在转换兼容视频" },
    );
  };
  mount(
    <TelegramInlineMediaItem attachment={media("AVAILABLE", "video/mp4")} />,
  );
  await waitFor(() =>
    assert.equal(
      document.querySelector("video")?.getAttribute("src"),
      "/api/telegram/media/9/stream?ticket=test",
    ),
  );
  assert(document.querySelector("video")?.controls);
  fireEvent.error(document.querySelector("video")!);
  fireEvent.click(await screen.findByRole("button", { name: "转换兼容格式" }));
  await screen.findByText("正在转换兼容视频");
  assert(
    calls.some((call) => call === "POST /api/telegram/media/9/video-preview"),
  );
});

test("重新校验权限失败后移除已有媒体，不保留缓存图片或误报无媒体", async () => {
  URL.createObjectURL = () => "blob:permission-check";
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/content"))
      return new Response(new Blob(["image"]));
    return reply(
      String(url).includes("/messages?")
        ? { items: [row()] }
        : { status: "COMPLETED" },
    );
  };
  mount(modal());
  await screen.findByAltText("sample");
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ success: false, message: "无权访问该任务" }),
      { status: 403 },
    );
  await act(() => client.invalidateQueries());
  await screen.findByText("无权访问该任务");
  assert.equal(screen.queryByAltText("sample"), null);
  assert.equal(screen.queryByText("未读取到原消息"), null);
  assert.deepEqual(revoked, ["blob:permission-check"]);
});

test("图片读取权限被拒绝时显示准确原因并支持重试", async () => {
  globalThis.fetch = async () => new Response(null, { status: 403 });
  mount(<TelegramInlineMediaItem attachment={media()} />);
  await screen.findByText("当前账号没有图片读取权限");
  URL.createObjectURL = () => "blob:retry-image";
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async () => new Response(new Blob(["image"]));
  fireEvent.click(screen.getByRole("button", { name: "重试图片" }));
  assert.equal(
    (await screen.findByAltText("sample")).getAttribute("src"),
    "blob:retry-image",
  );
});

test("原视频重新加载票据后保留播放位置，失败提示恢复后消失", async () => {
  let ticket = 0;
  globalThis.fetch = async () =>
    reply({ url: `/api/telegram/media/9/stream?ticket=${++ticket}` });
  mount(
    <TelegramInlineMediaItem attachment={media("AVAILABLE", "video/mp4")} />,
  );
  await waitFor(() => assert(document.querySelector("video")));
  const first = document.querySelector("video")!;
  first.currentTime = 18;
  fireEvent.timeUpdate(first);
  fireEvent.error(first);
  fireEvent.click(await screen.findByRole("button", { name: "重新加载" }));
  await waitFor(() => assert.notEqual(document.querySelector("video"), first));
  const replacement = document.querySelector("video")!;
  Object.defineProperty(replacement, "duration", {
    value: 30,
    configurable: true,
  });
  fireEvent.loadedMetadata(replacement);
  assert.equal(replacement.currentTime, 18);
  assert.equal(
    screen.queryByText("视频播放失败，可重新加载或转换为兼容格式"),
    null,
  );
});

test("播放授权失败不持续显示加载，重试成功后出现播放器", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: false, message: "没有下载权限" }), {
      status: 403,
    });
  mount(
    <TelegramInlineMediaItem attachment={media("AVAILABLE", "video/mp4")} />,
  );
  await screen.findByText("没有下载权限");
  assert.equal(document.querySelector(".ant-spin-spinning"), null);
  globalThis.fetch = async () =>
    reply({ url: "/api/telegram/media/9/stream?ticket=retry" });
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await waitFor(() => assert(document.querySelector("video")));
  assert.equal(screen.queryByText("没有下载权限"), null);
});

test("MKV、MOV 和未知 MIME 的视频文档直接提供转换，不请求无效播放票据", async () => {
  for (const [type, fileName] of [
    ["video/x-matroska", "sample.mkv"],
    ["video/quicktime", "sample.mov"],
    ["application/octet-stream", "sample.M4V"],
    ["video/webm", "older-file.mkv"],
    ["video/mp4", "older-file.mov"],
  ]) {
    const calls: string[] = [];
    globalThis.fetch = async (url, options) => {
      calls.push(`${options?.method ?? "GET"} ${url}`);
      return reply({ status: "PROCESSING", statusMessage: "正在转换兼容视频" });
    };
    const view = mount(
      <TelegramInlineMediaItem
        attachment={{ ...media("AVAILABLE", type), kind: "DOCUMENT", fileName }}
      />,
    );
    await screen.findByText("此视频需要转换为浏览器兼容格式");
    assert.equal(document.querySelector("video"), null);
    assert.equal(document.querySelector(".ant-spin-spinning"), null);
    assert.deepEqual(calls, []);
    fireEvent.click(screen.getByRole("button", { name: "转换兼容格式" }));
    await screen.findByText("正在转换兼容视频");
    assert(calls.includes("POST /api/telegram/media/9/video-preview"));
    assert.equal(
      calls.some((call) => call.includes("stream-ticket")),
      false,
    );
    view.unmount();
    client.clear();
  }
});

test("普通文件和伪装为视频名称的非视频 MIME 不自动请求视频预览", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected video request");
  };
  for (const [type, fileName] of [
    ["application/pdf", "document.mp4"],
    ["application/octet-stream", "sample.mp4.exe"],
    ["application/octet-stream", "sample.avi"],
  ]) {
    const view = mount(
      <TelegramInlineMediaItem
        attachment={{ ...media("AVAILABLE", type), kind: "DOCUMENT", fileName }}
      />,
    );
    await screen.findByText(fileName);
    assert.equal(screen.queryByRole("button", { name: "转换兼容格式" }), null);
    assert.equal(document.querySelector("video"), null);
    view.unmount();
    client.clear();
  }
  assert.equal(calls, 0);
});
