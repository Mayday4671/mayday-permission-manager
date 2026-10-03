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
// 表单错误定位读取视口，JSDOM 的 Node 全局需要显式映射这些浏览器属性。
globalThis.innerWidth = dom.window.innerWidth;
globalThis.innerHeight = dom.window.innerHeight;
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
const { PortalArticleCard } = await import("../src/components/PortalViews");
const { PortalFeedback } = await import("../src/components/PortalFeedback");
const { PORTAL_APPEARANCE, ADMIN_APPEARANCE } =
  await import("../src/lib/theme-model");
const clients = [];
const routers = [];
let requests = [];
let allowThemeToggle = true;
let feedbackEnabled = false;
let noSearchResults = false;
let feedbackRequests = [];
// 固定凭据只用于内存接口回归，不写入真实数据库或浏览器持久存储。
const testReceipt = "a".repeat(48);
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
globalThis.fetch = async (path, options) => {
  const url = new URL(
    path instanceof Request ? path.url : String(path),
    "http://localhost",
  );
  const envelope = (data) => Response.json({ success: true, data });
  if (url.pathname === "/api/platform/features")
    return envelope({
      modules: { portal: true, content: true, feedback: feedbackEnabled },
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
      items:
        noSearchResults && url.searchParams.get("keyword")
          ? []
          : [
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
      total: noSearchResults && url.searchParams.get("keyword") ? 0 : 1,
    });
  }
  if (url.pathname.startsWith("/api/public/feedback")) {
    const body =
      path instanceof Request
        ? await path.clone().json()
        : JSON.parse(options?.body ?? "{}");
    feedbackRequests.push({ path: url.pathname, body });
    if (url.pathname === "/api/public/feedback")
      return envelope({ receipt: testReceipt });
    assert.equal(body.receipt, testReceipt);
    return envelope({
      title: "搜索体验问题",
      status: "OPEN",
      createdAt: "2026-10-03T10:00:00",
      history: [],
    });
  }
  throw new Error("未预期请求：" + url.pathname);
};
function mount(path, extraRoutes = null) {
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
                {extraRoutes}
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
  feedbackEnabled = false;
  noSearchResults = false;
  feedbackRequests = [];
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

test("空搜索结果可直接清空关键词，保留栏目分类且只有一个一级标题", async () => {
  noSearchResults = true;
  const router = mount("/channels/guides?category=11&q=不存在&page=2");
  await screen.findByText("未找到匹配内容，请尝试其他标题关键词");
  assert.equal(screen.getAllByRole("heading", { level: 1 }).length, 1);
  assert(screen.getByRole("heading", { name: "搜索结果", level: 2 }));
  fireEvent.click(await screen.findByRole("button", { name: "清空关键词" }));
  await screen.findByRole("link", { name: "阅读指南" });
  const params = new URLSearchParams(router.state.location.search);
  assert.equal(router.state.location.pathname, "/channels/guides");
  assert.equal(params.get("category"), "11");
  assert(!params.has("q"));
  assert(!params.has("page"));
});

test("纯图片入口有文章名称，并保留正文链接和来源上下文", async () => {
  const article = {
    id: 7,
    title: "账户使用指南",
    categoryId: 11,
    category: "账号帮助",
    channelCode: "guides",
    channelTemplate: "GUIDE",
    createdAt: "2026-10-03T10:00:00",
  };
  mount(
    "/card?category=11",
    <Route path="/card" element={<PortalArticleCard article={article} />} />,
  );
  const cover = await screen.findByRole("link", { name: "阅读：账户使用指南" });
  assert.equal(cover.getAttribute("href"), "/articles/7");
  assert.equal(
    screen
      .getByRole("link", { name: "账户使用指南", exact: true })
      .getAttribute("href"),
    "/articles/7",
  );
});

test("反馈提交后可以直达查询，粘贴空格和大写查询码仍可读取真实进度", async () => {
  feedbackEnabled = true;
  mount("/feedback", <Route path="/feedback" element={<PortalFeedback />} />);
  fireEvent.click(await screen.findByRole("button", { name: "反馈问题" }));
  const submit = await screen.findByRole("dialog", { name: "提交反馈" });
  fireEvent.change(within(submit).getByLabelText("标题"), {
    target: { value: "搜索体验问题" },
  });
  fireEvent.change(within(submit).getByLabelText("详细说明"), {
    target: { value: "空结果需要明确恢复入口。" },
  });
  fireEvent.click(within(submit).getByRole("button", { name: /^提\s*交$/ }));
  fireEvent.click(await screen.findByRole("button", { name: "查看处理进度" }));
  const tracking = await screen.findByRole("dialog", { name: "查询反馈" });
  fireEvent.change(within(tracking).getByLabelText("查询码"), {
    target: { value: " \n" + testReceipt.toUpperCase() + "\n " },
  });
  assert.equal(within(tracking).getByLabelText("查询码").value, testReceipt);
  fireEvent.click(within(tracking).getByRole("button", { name: /^查\s*询$/ }));
  const progress = await screen.findByRole("dialog", { name: "反馈处理进度" });
  assert(within(progress).getByText("搜索体验问题"));
  assert(within(progress).getByText("反馈已收到，等待处理。"));
  assert.equal(feedbackRequests.length, 2);
  assert.equal(feedbackRequests[1].body.receipt, testReceipt);
});

test("不完整的查询码只提示校验，不向服务端提交", async () => {
  feedbackEnabled = true;
  mount("/feedback", <Route path="/feedback" element={<PortalFeedback />} />);
  fireEvent.click(await screen.findByRole("button", { name: "查询反馈" }));
  const tracking = await screen.findByRole("dialog", { name: "查询反馈" });
  fireEvent.change(within(tracking).getByLabelText("查询码"), {
    target: { value: "abc" },
  });
  fireEvent.click(within(tracking).getByRole("button", { name: /^查\s*询$/ }));
  await screen.findByText("请输入完整查询码");
  assert.equal(feedbackRequests.length, 0);
});
