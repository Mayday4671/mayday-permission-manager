import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";

// 只验证路由、查询和主题状态；真实尺寸、图片和滚动另以浏览器截图验收。
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLBodyElement",
  "HTMLHtmlElement",
  "Document",
  "HTMLInputElement",
  "Element",
  "SVGElement",
  "ShadowRoot",
  "Node",
  "MutationObserver",
  "localStorage",
  "sessionStorage",
  "Event",
  "MouseEvent",
  "FormData",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
});
dom.window.scrollTo = () => {};
const ports = [];
const NativeChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeChannel {
  constructor() {
    super();
    ports.push(this);
  }
};
const React = await import("react");
const { render, screen, fireEvent, waitFor, cleanup, within, act } =
  await import("@testing-library/react");
const { createMemoryRouter, RouterProvider, Routes, Route } =
  await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { ModulesProvider } = await import("../src/lib/modules");
const { AppearanceProvider } = await import("../src/lib/theme");
const { PortalChannelPage } = await import("../src/pages/PortalChannelPage");
const { PORTAL_APPEARANCE, ADMIN_APPEARANCE } =
  await import("../src/lib/theme-model");
const clients = [];
const routers = [];
let requests = [];
let allowThemeToggle = true;
const channel = {
  id: 1,
  code: "guides",
  name: "使用指南",
  template: "GUIDE",
  description: "阅读操作说明",
  enabled: true,
  sortOrder: 0,
  categories: [
    { id: 11, name: "账号帮助", enabled: true },
    { id: 12, name: "业务帮助", enabled: true },
  ],
};
globalThis.fetch = async (path) => {
  const url = new URL(
    path instanceof Request ? path.url : String(path),
    "http://localhost",
  );
  const envelope = (data) => Response.json({ success: true, data });
  if (url.pathname === "/api/platform/features")
    return envelope({
      modules: { portal: true, content: true, feedback: false },
    });
  if (url.pathname === "/api/public/site")
    return envelope({
      name: "Mayday",
      channels: [channel],
      theme: PORTAL_APPEARANCE,
      allowThemeToggle,
      nightPrimaryColor: "#53d5be",
    });
  if (url.pathname === "/api/public/articles") {
    requests.push(url);
    return envelope({
      items: [
        {
          id: 1,
          title: "指南正文",
          summary: "操作步骤",
          categoryId: 11,
          category: "账号帮助",
          channelCode: "guides",
          channelTemplate: "GUIDE",
          tags: [],
          createdAt: "2026-10-03T10:00:00",
        },
      ],
      total: 1,
    });
  }
  throw new Error("未预期请求：" + url.pathname);
};
function mount(path) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30000 } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <ModulesProvider>
            <AppearanceProvider>
              <Routes>
                <Route
                  path="/channels/:channelCode"
                  element={<PortalChannelPage />}
                />
                <Route path="/admin" element={<span>后台页</span>} />
              </Routes>
            </AppearanceProvider>
          </ModulesProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  routers.push(router);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  routers.splice(0).forEach((r) => r.dispose());
  requests = [];
  allowThemeToggle = true;
  localStorage.clear();
});
after(() => {
  ports.forEach((c) => {
    c.port1.close();
    c.port2.close();
  });
  dom.window.close();
});

test("分类只改变当前栏目查询，搜索保留栏目及分类并重置分页", async () => {
  const router = mount("/channels/guides?category=11&page=2");
  await screen.findByRole("heading", {
    name: "从这里，开始高效使用",
    level: 1,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "业务帮助", exact: true }),
  );
  await waitFor(() =>
    assert.equal(
      new URLSearchParams(router.state.location.search).get("category"),
      "12",
    ),
  );
  assert.equal(router.state.location.pathname, "/channels/guides");
  assert(!new URLSearchParams(router.state.location.search).has("page"));
  fireEvent.change(screen.getByPlaceholderText("搜索内容"), {
    target: { value: "账号" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索", exact: true }));
  await waitFor(() =>
    assert.equal(
      new URLSearchParams(router.state.location.search).get("q"),
      "账号",
    ),
  );
  assert.equal(
    new URLSearchParams(router.state.location.search).get("category"),
    "12",
  );
  assert(requests.every((url) => url.searchParams.get("channel") === "guides"));
  assert.equal(
    within(screen.getByRole("navigation", { name: "网站导航" }))
      .getByRole("link", { name: "使用指南" })
      .getAttribute("href"),
    "/channels/guides",
  );
});
test("跨栏目分类和未知栏目不发起全部内容查询", async () => {
  mount("/channels/guides?category=999");
  await screen.findByText("该栏目或分类不存在，或已停用");
  assert.equal(requests.length, 0);
});
test("访客暗夜偏好只作用前台，进入后台恢复后台自己的主题", async () => {
  localStorage.setItem(
    "mayday.admin.appearance.v1",
    JSON.stringify({ ...ADMIN_APPEARANCE, mode: "light" }),
  );
  const router = mount("/channels/guides");
  fireEvent.click(
    await screen.findByRole("button", { name: "切换暗夜模式", exact: true }),
  );
  await waitFor(() =>
    assert.equal(
      document.querySelector(".theme-scope").getAttribute("data-theme"),
      "dark",
    ),
  );
  assert.equal(localStorage.getItem("mayday.portal.mode.v1"), "dark");
  assert.equal(
    JSON.parse(localStorage.getItem("mayday.admin.appearance.v1")).mode,
    "light",
  );
  await act(async () => {
    await router.navigate("/admin");
  });
  await screen.findByText("后台页");
  await waitFor(() =>
    assert.equal(
      document.querySelector(".theme-scope").getAttribute("data-theme"),
      "light",
    ),
  );
});
test("后台关闭访客切换后，已存偏好不能覆盖网站统一浅色模式", async () => {
  allowThemeToggle = false;
  localStorage.setItem("mayday.portal.mode.v1", "dark");
  mount("/channels/guides");
  await screen.findByRole("heading", {
    name: "从这里，开始高效使用",
    level: 1,
  });
  assert.equal(
    document.querySelector(".theme-scope").getAttribute("data-theme"),
    "light",
  );
  assert.equal(screen.queryByRole("button", { name: /切换.*模式/ }), null);
});
