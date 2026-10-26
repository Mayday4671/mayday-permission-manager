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
  "HTMLImageElement",
  "HTMLVideoElement",
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
  assert.equal(document.querySelector("video")?.controls, false);
  assert(screen.getByRole("slider", { name: "播放进度" }));
  assert(screen.getByRole("button", { name: "播放", exact: true }));
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

test("大文件直接交给浏览器下载管理器，不读取整文件 Blob", async () => {
  tokenStore.set("large-file-session");
  const saved: string[] = [];
  const originalClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () {
    saved.push(this.href);
  };
  let requests = 0;
  try {
    URL.createObjectURL = () => {
      throw new Error("大文件不得使用 Blob");
    };
    globalThis.fetch = async (url, options) => {
      requests++;
      assert.equal(String(url), "/api/telegram/media/9/download-ticket");
      assert.equal(options?.method, "POST");
      return reply({
        url: "/api/telegram/media/9/download?ticket=test-capability",
      });
    };
    mount(
      <TelegramAttachmentDownload
        attachment={{
          ...media("AVAILABLE", "video/mp4"),
          actualSize: 4 * 1024 ** 3,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "下载文件" }));
    await waitFor(() => assert.equal(saved.length, 1));
    assert(saved[0].includes("/download?ticket="));
    assert.equal(requests, 1);
  } finally {
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("失败附件原地重试，不重建任务或重复下载成功附件", async () => {
  let retried = false;
  let recreated = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/media/9/retry")) {
      assert.equal(options?.method, "POST");
      retried = true;
      return reply({});
    }
    if (String(url).includes("/messages?"))
      return reply({
        items: [
          row([
            {
              ...media(retried ? "QUEUED" : "FAILED"),
              failureMessage: "附件超过服务端配置的单文件大小上限",
            },
          ]),
        ],
      });
    return reply({ status: "COMPLETED" });
  };
  mount(
    modal(() => {
      recreated = true;
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "重试下载" }));
  await waitFor(() => assert(retried));
  assert.equal(recreated, false);
});

test("主预览只挂载当前附件，切换时停止旧播放器且下载指向当前文件", async () => {
  const video = {
    ...media("REMOTE", "video/mp4"),
    id: 10,
    fileName: "演示.mp4",
  };
  const image = {
    ...media(),
    id: 11,
    fileName: "配图.jpg",
    contentUrl: "/api/telegram/media/11/content",
  };
  const calls: string[] = [];
  URL.createObjectURL = () => "blob:gallery-image";
  URL.revokeObjectURL = () => {};
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/content"))
      return new Response(new Blob(["image"], { type: "image/jpeg" }));
    return reply(
      String(url).endsWith("/stream-ticket")
        ? { url: "/api/telegram/media/10/stream?ticket=test" }
        : String(url).includes("/messages?")
          ? { items: [row([video, image])] }
          : { status: "COMPLETED" },
    );
  };
  mount(modal());
  await waitFor(() =>
    assert.equal(document.querySelectorAll("video").length, 1),
  );
  assert.equal(calls.filter((url) => url.endsWith("/content")).length, 0);
  fireEvent.click(screen.getByRole("button", { name: "下一个附件" }));
  await screen.findByAltText("配图.jpg");
  assert.equal(document.querySelector("video"), null);
  assert.equal(screen.getAllByRole("button", { name: "下载文件" }).length, 1);
  fireEvent.click(screen.getByRole("button", { name: "上一个附件" }));
  await waitFor(() =>
    assert.equal(document.querySelectorAll("video").length, 1),
  );
  assert.equal(screen.queryByAltText("配图.jpg"), null);
});

test("播放器支持快进快退、边界限位和倍速", async () => {
  globalThis.fetch = async () =>
    reply({ url: "/api/telegram/media/9/stream?ticket=test" });
  mount(<TelegramInlineMediaItem attachment={media("REMOTE", "video/mp4")} />);
  await waitFor(() => assert(document.querySelector("video")));
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 60 });
  video.currentTime = 30;
  fireEvent.loadedMetadata(video);
  fireEvent.click(screen.getByRole("button", { name: "快进 10 秒" }));
  assert.equal(video.currentTime, 40);
  fireEvent.click(screen.getByRole("button", { name: "快退 10 秒" }));
  assert.equal(video.currentTime, 30);
  video.currentTime = 2;
  fireEvent.click(screen.getByRole("button", { name: "快退 10 秒" }));
  assert.equal(video.currentTime, 0);
  video.currentTime = 58;
  fireEvent.keyDown(screen.getByRole("region", { name: "视频播放器" }), {
    key: "ArrowRight",
  });
  assert.equal(video.currentTime, 60);
  fireEvent.click(screen.getByRole("button", { name: "播放速度" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "1.5×" }));
  assert.equal(video.playbackRate, 1.5);
});

test("网页全屏保留播放器和进度，Escape 只退出全屏", async () => {
  globalThis.fetch = async () =>
    reply({ url: "/api/telegram/media/9/stream?ticket=test" });
  mount(<TelegramInlineMediaItem attachment={media("REMOTE", "video/mp4")} />);
  await waitFor(() => assert(document.querySelector("video")));
  const video = document.querySelector("video")!;
  video.currentTime = 18;
  fireEvent.click(screen.getByRole("button", { name: "网页全屏" }));
  assert(document.querySelector(".is-web-fullscreen"));
  assert.equal(document.querySelector("video"), video);
  assert.equal(video.currentTime, 18);
  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(document.querySelector(".is-web-fullscreen"), null);
  assert.equal(document.querySelector("video"), video);
});

test("浏览器拒绝原生全屏时回退网页全屏", async () => {
  const previous = HTMLElement.prototype.requestFullscreen;
  HTMLElement.prototype.requestFullscreen = async () => {
    throw new Error("permission denied");
  };
  try {
    globalThis.fetch = async () =>
      reply({ url: "/api/telegram/media/9/stream?ticket=test" });
    mount(
      <TelegramInlineMediaItem attachment={media("REMOTE", "video/mp4")} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "全屏播放" }));
    await screen.findByText("当前浏览器未允许全屏，已切换网页全屏");
    assert(document.querySelector(".is-web-fullscreen"));
  } finally {
    HTMLElement.prototype.requestFullscreen = previous;
  }
});

test("打开画廊即加载所有封面并设置主视频海报，无需先播放其他视频", async () => {
  tokenStore.set("cover-session");
  const covers: number[] = [];
  const tickets: number[] = [];
  const released: string[] = [];
  let serial = 0;
  URL.createObjectURL = () => `blob:cover-${++serial}`;
  URL.revokeObjectURL = (url) => released.push(url);
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.endsWith("/thumbnail")) {
      assert.equal(
        (options?.headers as any).Authorization,
        "Bearer cover-session",
      );
      assert.equal(options?.cache, "no-store");
      covers.push(Number(url.split("/").at(-2)));
      return new Response("small-cover", {
        headers: { "Content-Type": "image/jpeg" },
      });
    }
    if (url.endsWith("/stream-ticket")) {
      const id = Number(url.split("/").at(-2));
      tickets.push(id);
      return reply({ url: `/api/telegram/media/${id}/stream?ticket=sample` });
    }
    if (url.includes("/messages?"))
      return reply({
        items: [
          row([
            media("REMOTE", "video/mp4"),
            { ...media("REMOTE", "video/mp4"), id: 10 },
          ]),
        ],
      });
    return reply({ id: 4, status: "COMPLETED" });
  };
  const view = mount(modal());
  await waitFor(() =>
    assert.equal(
      document.querySelectorAll(".telegram-media-gallery-tile img").length,
      2,
    ),
  );
  const video = document.querySelector("video")!;
  await waitFor(() => assert(video.poster.startsWith("blob:cover-")));
  assert.equal(video.currentTime, 0);
  assert.equal(video.paused, true);
  assert.deepEqual(
    covers.sort((a, b) => a - b),
    [9, 10],
  );
  assert.deepEqual(tickets, [9]);
  const firstPoster = video.poster;
  fireEvent.click(screen.getByRole("button", { name: "下一个附件" }));
  await waitFor(() => assert.equal(tickets.length, 2));
  await waitFor(() =>
    assert(document.querySelector("video")?.poster.startsWith("blob:cover-")),
  );
  assert.notEqual(document.querySelector("video")!.poster, firstPoster);
  assert.equal(covers.length, 2);
  view.unmount();
  assert.equal(released.length, 2);
});

test("封面失败可单独重试，关闭画廊中止等待且不遗留私有图片地址", async () => {
  let attempts = 0;
  let aborted = false;
  const released: string[] = [];
  URL.createObjectURL = () => "blob:retry-cover";
  URL.revokeObjectURL = (url) => released.push(url);
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.endsWith("/thumbnail")) {
      attempts++;
      options?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return attempts === 1
        ? new Response("unavailable", { status: 503 })
        : new Response("cover", { headers: { "Content-Type": "image/jpeg" } });
    }
    if (url.endsWith("/stream-ticket"))
      return reply({ url: "/api/telegram/media/9/stream?ticket=sample" });
    if (url.includes("/messages?"))
      return reply({ items: [row([media("REMOTE", "video/mp4")])] });
    return reply({ id: 4, status: "COMPLETED" });
  };
  const view = mount(modal());
  fireEvent.click(await screen.findByRole("button", { name: "重试封面" }));
  await waitFor(() =>
    assert.equal(document.querySelector("video")?.poster, "blob:retry-cover"),
  );
  assert.equal(attempts, 2);
  assert.equal(screen.queryByRole("button", { name: "重试封面" }), null);
  view.unmount();
  assert.equal(aborted, true);
  assert.deepEqual(released, ["blob:retry-cover"]);
});

test("进度拖动只在松开时定位，支持方向键及音量静音", async () => {
  globalThis.fetch = async () =>
    reply({ url: "/api/telegram/media/9/stream?ticket=test" });
  mount(<TelegramInlineMediaItem attachment={media("REMOTE", "video/mp4")} />);
  await waitFor(() => assert(document.querySelector("video")));
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 120 });
  video.currentTime = 10;
  fireEvent.loadedMetadata(video);
  const progress = screen.getByRole("slider", { name: "播放进度" });
  fireEvent.pointerDown(progress);
  fireEvent.change(progress, { target: { value: "80" } });
  assert.equal(video.currentTime, 10);
  assert.equal(progress.getAttribute("aria-valuetext"), "1:20 / 2:00");
  fireEvent.pointerUp(progress);
  assert.equal(video.currentTime, 80);
  fireEvent.keyDown(progress, { key: "ArrowLeft" });
  assert.equal(video.currentTime, 75);
  fireEvent.keyDown(progress, { key: "End" });
  assert.equal(video.currentTime, 120);
  fireEvent.change(screen.getByRole("slider", { name: "音量" }), {
    target: { value: "0.35" },
  });
  assert.equal(video.volume, 0.35);
  fireEvent.click(screen.getByRole("button", { name: "静音", exact: true }));
  assert.equal(video.muted, true);
  fireEvent.click(screen.getByRole("button", { name: "取消静音" }));
  assert.equal(video.muted, false);
  assert.equal(video.volume, 0.35);
});

test("播放时控制层自动隐藏，指针唤醒；暂停、键盘操作与倍速菜单保持可用", async () => {
  globalThis.fetch = async () =>
    reply({ url: "/api/telegram/media/9/stream?ticket=test" });
  mount(<TelegramInlineMediaItem attachment={media("REMOTE", "video/mp4")} />);
  await waitFor(() => assert(document.querySelector("video")));
  const video = document.querySelector("video")!;
  let paused = true;
  Object.defineProperty(video, "paused", {
    configurable: true,
    get: () => paused,
  });
  video.play = async () => {
    paused = false;
    fireEvent.play(video);
  };
  video.pause = () => {
    paused = true;
    fireEvent.pause(video);
  };
  fireEvent.click(screen.getByRole("button", { name: "播放", exact: true }));
  assert.equal(paused, false);
  await waitFor(
    () => assert(document.querySelector(".telegram-video-player.is-idle")),
    { timeout: 3500 },
  );
  const region = screen.getByRole("region", { name: "视频播放器" });
  fireEvent.pointerMove(region);
  assert(region.classList.contains("has-controls"));
  fireEvent.keyDown(region, { key: " " });
  assert.equal(paused, true);
  fireEvent.click(screen.getByRole("button", { name: "播放速度" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "播放速度" }), {
    key: "ArrowUp",
  });
  assert.equal(document.activeElement?.textContent, "2×");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "2×" }));
  assert.equal(video.playbackRate, 2);
  assert.equal(screen.queryByRole("menu"), null);
});

test("切换真实清晰度选项保留进度、倍速、音量和全屏，不重新创建播放票据", async () => {
  let tickets = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/video-qualities"))
      return reply([
        { id: "original", width: 1920, height: 1080, codec: "", size: 9000 },
        {
          id: "alt:9223372036854775807",
          width: 1280,
          height: 720,
          codec: "h264",
          size: 4000,
        },
      ]);
    tickets++;
    return reply({ url: "/api/telegram/media/9/stream?ticket=test" });
  };
  mount(<TelegramInlineMediaItem attachment={media("REMOTE", "video/mp4")} />);
  fireEvent.click(await screen.findByRole("button", { name: "视频清晰度" }));
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "duration", { configurable: true, value: 120 });
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  video.currentTime = 42;
  video.playbackRate = 1.5;
  video.volume = 0.35;
  video.muted = true;
  let resumed = 0;
  video.play = async () => {
    resumed++;
  };
  fireEvent.loadedMetadata(video);
  fireEvent.click(screen.getByRole("menuitemradio", { name: "720p · H264" }));
  assert(
    document
      .querySelector("video")!
      .src.includes("quality=alt%3A9223372036854775807"),
  );
  assert.equal(document.querySelector("video"), video);
  video.currentTime = 0;
  video.playbackRate = 1;
  video.volume = 1;
  video.muted = false;
  fireEvent.loadedMetadata(video);
  assert.equal(video.currentTime, 42);
  assert.equal(video.playbackRate, 1.5);
  assert.equal(video.volume, 0.35);
  assert.equal(video.muted, true);
  assert.equal(resumed, 1);
  fireEvent.click(screen.getByRole("button", { name: "网页全屏" }));
  fireEvent.click(screen.getByRole("button", { name: "视频清晰度" }));
  fireEvent.click(
    screen.getByRole("menuitemradio", { name: "源文件 · 1080p" }),
  );
  assert(!video.src.includes("quality="));
  assert(document.querySelector(".is-web-fullscreen"));
  assert.equal(tickets, 1);
});

test("仅源文件时不虚列清晰度，读取失败可独立重试且原视频继续可播放", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/video-qualities")) {
      calls++;
      return calls === 1
        ? new Response("unavailable", { status: 503 })
        : reply([
            {
              id: "original",
              width: 1080,
              height: 1920,
              codec: "",
              size: 9000,
            },
          ]);
    }
    return reply({ url: "/api/telegram/media/9/stream?ticket=test" });
  };
  mount(<TelegramInlineMediaItem attachment={media("REMOTE", "video/mp4")} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "重新读取清晰度" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "视频清晰度" }));
  assert.equal(screen.getAllByRole("menuitemradio").length, 1);
  assert(screen.getByRole("menuitemradio", { name: "源文件 · 1080p" }));
  assert.equal(
    document.querySelector("video")?.getAttribute("src"),
    "/api/telegram/media/9/stream?ticket=test",
  );
});
