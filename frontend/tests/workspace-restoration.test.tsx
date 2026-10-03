import { JSDOM } from "jsdom";
import * as nodeModule from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * 使用真实身份上下文、登录返回路由和页签组件重现刷新问题；身份与接口响应全部属于测试内存。
 * CSS 在 Node 中忽略，测试不访问真实数据库，不修改真实浏览器的令牌或业务记录。
 */
const styles = nodeModule.registerHooks?.({
  load(url, context, nextLoad) {
    if (url.endsWith(".css"))
      return { format: "module", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});
if (!styles)
  nodeModule.register(
    `data:text/javascript,${encodeURIComponent(
      'export async function load(url, context, nextLoad) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return nextLoad(url, context); }',
    )}`,
    import.meta.url,
  );
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
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "Document",
  "Element",
  "SVGElement",
  "ShadowRoot",
  "Node",
  "MutationObserver",
  "localStorage",
  "sessionStorage",
  "Event",
  "MouseEvent",
  "StorageEvent",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
globalThis.innerWidth = 1366;
globalThis.innerHeight = 900;
globalThis.scrollX = 0;
globalThis.scrollY = 0;
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
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
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const React = await import("react");
const { render, screen, waitFor, cleanup, act, fireEvent } =
  await import("@testing-library/react");
const { ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useNavigate,
  useSearchParams,
} = await import("react-router-dom");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { tokenStore } = await import("../src/lib/api");
const { ModulesProvider } = await import("../src/lib/modules");
const { WorkspaceProvider, useWorkspace } =
  await import("../src/lib/workspace");
const { WorkspaceTabs } = await import("../src/components/WorkspaceTabs");
const { Protected } = await import("../src/App");
const { LoginPage } = await import("../src/pages/LoginPage");

const clients: InstanceType<typeof QueryClient>[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const pendingIdentity: ((response: Response) => void)[] = [];
const originalFetch = globalThis.fetch;
let deferIdentity = false;
let accountId = 101;
let permissions = ["dashboard:view", "users:view", "workflows:view"];
const designer = "/admin/workflow-designer";

function identityResponse(id = accountId, permitted = permissions) {
  return Response.json({
    success: true,
    data: {
      user: { id, nickname: `合成账号 ${id}` },
      permissions: permitted,
      dataScopes: {},
      admin: false,
    },
  });
}
/** 请求只返回合成身份；延迟响应精确控制 StrictMode、退出及切换账号的到达顺序。 */
globalThis.fetch = async (input, options) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    "http://localhost",
  );
  const method =
    options?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.pathname === "/api/auth/me") {
    if (deferIdentity)
      return new Promise<Response>((resolve) => pendingIdentity.push(resolve));
    return identityResponse();
  }
  if (url.pathname === "/api/auth/login" && method === "POST")
    return Response.json({
      success: true,
      data: { token: `synthetic-session-${accountId}` },
    });
  if (url.pathname === "/api/auth/logout")
    return Response.json({ success: true, data: null });
  if (url.pathname === "/api/platform/features")
    return Response.json({
      success: true,
      data: { modules: { approvals: true, portal: false } },
    });
  throw new Error(`测试未定义接口：${url.pathname}`);
};

function IdentityControls() {
  const auth = useAuth();
  return (
    <>
      <output aria-label="身份状态">
        {auth.loading ? "确认中" : (auth.session?.user.nickname ?? "未登录")}
      </output>
      <button onClick={() => void auth.refresh().catch(() => {})}>
        更新身份
      </button>
      <button onClick={() => void auth.logout().catch(() => {})}>
        退出合成账号
      </button>
      <button
        onClick={() =>
          void auth
            .login("synthetic", "synthetic", "synthetic-proof")
            .catch(() => {})
        }
      >
        登录合成账号
      </button>
    </>
  );
}
function WorkspaceShell() {
  const { session } = useAuth();
  return (
    <WorkspaceProvider key={session!.user.id}>
      <WorkspaceTabs titles={{}} />
      <WorkspaceControls />
      <Outlet />
    </WorkspaceProvider>
  );
}
function WorkspaceControls() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => workspace.refresh(designer)}>刷新流程页签</button>
      <button onClick={() => workspace.close(workspace.active, "current")}>
        关闭活动页
      </button>
      <button onClick={() => navigate(`${designer}?id=27`)}>
        打开另一流程
      </button>
      <button onClick={() => navigate(designer)}>打开空流程设计</button>
    </>
  );
}
function DesignerRoute() {
  const [params] = useSearchParams();
  return (
    <div>
      {params.get("id") ? `流程记录 ${params.get("id")}` : "尚未选择流程"}
    </div>
  );
}
/** 路由使用产品的 Protected 与 LoginPage；设计内容替身仅显示 ID，避免把本测试变为整个业务接口套件。 */
function mount(
  initialEntry: string | { pathname: string; state: unknown },
  strict = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        element: (
          <QueryClientProvider client={client}>
            <ConfigProvider theme={{ token: { motion: false } }}>
              <AuthProvider>
                <IdentityControls />
                <ModulesProvider>
                  <Outlet />
                </ModulesProvider>
              </AuthProvider>
            </ConfigProvider>
          </QueryClientProvider>
        ),
        children: [
          {
            element: <Protected />,
            children: [
              {
                path: "/admin",
                element: <WorkspaceShell />,
                children: [
                  { index: true, element: <div>工作台内容</div> },
                  { path: "users", element: <div>用户页内容</div> },
                  { path: "profile", element: <div>个人页内容</div> },
                  { path: "workflow-designer", element: <DesignerRoute /> },
                ],
              },
            ],
          },
          { path: "/login", element: <LoginPage /> },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  routers.push(router);
  const root = <RouterProvider router={router} />;
  return {
    ...render(strict ? <React.StrictMode>{root}</React.StrictMode> : root),
    router,
  };
}
/** 等待网络队列到达，避免测试把未构建请求误当作已经完成的旧请求。 */
async function settleIdentity(index: number, response = identityResponse()) {
  await act(async () => {
    pendingIdentity[index](response);
  });
}
beforeEach(() => {
  sessionStorage.clear();
  tokenStore.set("synthetic-session-101");
  pendingIdentity.length = 0;
  deferIdentity = false;
  accountId = 101;
  permissions = ["dashboard:view", "users:view", "workflows:view"];
});
afterEach(() => {
  cleanup();
  routers.splice(0).forEach((router) => router.dispose());
  clients.splice(0).forEach((client) => client.clear());
});
after(() => {
  globalThis.fetch = originalFetch;
  channels.forEach((channel) => {
    channel.port1.close();
    channel.port2.close();
  });
  globalThis.MessageChannel = NativeMessageChannel;
  styles?.deregister();
  dom.window.close();
});

test("StrictMode 初次响应不能提前结束身份等待，直接进入与重新挂载都保留流程 ID", async () => {
  deferIdentity = true;
  const view = mount(`${designer}?id=23`, true);
  await waitFor(() => assert.equal(pendingIdentity.length, 2));
  await settleIdentity(0);
  assert.equal(screen.getByLabelText("身份状态").textContent, "确认中");
  assert.equal(
    view.router.state.location.pathname + view.router.state.location.search,
    `${designer}?id=23`,
  );
  await settleIdentity(1);
  await screen.findByText("流程记录 23");
  const restored =
    view.router.state.location.pathname + view.router.state.location.search;
  view.unmount();
  view.router.dispose();
  deferIdentity = false;
  const reloaded = mount(restored, true);
  await screen.findByText("流程记录 23");
  assert.equal(reloaded.router.state.location.search, "?id=23");
});

test("焦点刷新取代初次请求时，由最新身份响应结束等待且旧响应不会恢复旧账号", async () => {
  deferIdentity = true;
  const { router } = mount(`${designer}?id=23`);
  await waitFor(() => assert.equal(pendingIdentity.length, 1));
  fireEvent(window, new Event("focus"));
  await waitFor(() => assert.equal(pendingIdentity.length, 2));
  await settleIdentity(0, identityResponse(99));
  assert.equal(screen.getByLabelText("身份状态").textContent, "确认中");
  await settleIdentity(1, identityResponse(101));
  await screen.findByText("流程记录 23");
  assert.equal(screen.getByLabelText("身份状态").textContent, "合成账号 101");
  assert.equal(router.state.location.search, "?id=23");
});

test("会话失效后登录返回保留白名单实体 ID，凭证和跳转参数不进入返回地址", async () => {
  deferIdentity = true;
  const { router } = mount(
    `${designer}?id=23&token=secret&redirect=https://example.com`,
  );
  await waitFor(() => assert.equal(pendingIdentity.length, 1));
  await settleIdentity(
    0,
    Response.json({ success: false, message: "合成会话过期" }, { status: 401 }),
  );
  await screen.findByText("后台登录");
  assert.equal(router.state.location.pathname, "/login");
  assert.deepEqual(router.state.location.state, { from: `${designer}?id=23` });
  assert.equal(screen.getByLabelText("身份状态").textContent, "未登录");
  deferIdentity = false;
  fireEvent.click(screen.getByRole("button", { name: "登录合成账号" }));
  await screen.findByText("流程记录 23");
  assert.equal(
    router.state.location.pathname + router.state.location.search,
    `${designer}?id=23`,
  );
});

test("初次身份确认过程中退出会结束等待，迟到响应不能重新登录或恢复流程页", async () => {
  deferIdentity = true;
  const { router } = mount(`${designer}?id=23`);
  await waitFor(() => assert.equal(pendingIdentity.length, 1));
  fireEvent.click(screen.getByRole("button", { name: "退出合成账号" }));
  await screen.findByText("后台登录");
  assert.equal(tokenStore.get(), null);
  await settleIdentity(0);
  assert.equal(screen.getByLabelText("身份状态").textContent, "未登录");
  assert.equal(router.state.location.pathname, "/login");
});

test("切换账号后旧身份响应不能覆盖新身份，旧账号流程目标不会进入新账号页签", async () => {
  mount(`${designer}?id=23`);
  await screen.findByText("流程记录 23");
  deferIdentity = true;
  fireEvent.click(screen.getByRole("button", { name: "更新身份" }));
  await waitFor(() => assert.equal(pendingIdentity.length, 1));
  deferIdentity = false;
  accountId = 102;
  permissions = ["dashboard:view", "users:view"];
  fireEvent.click(screen.getByRole("button", { name: "登录合成账号" }));
  await waitFor(() =>
    assert.equal(screen.getByLabelText("身份状态").textContent, "合成账号 102"),
  );
  await settleIdentity(
    0,
    identityResponse(101, ["dashboard:view", "workflows:view"]),
  );
  assert.equal(screen.getByLabelText("身份状态").textContent, "合成账号 102");
  assert.equal(tokenStore.get(), "synthetic-session-102");
  assert.equal(Boolean(screen.queryByRole("tab", { name: "流程设计" })), false);
  assert.deepEqual(
    JSON.parse(sessionStorage.getItem("mayday.workspace.tabs.102.targets")!),
    {},
  );
});

test("点击、键盘切换、刷新非活动页及关闭邻页均保留设计实体 ID", async () => {
  sessionStorage.setItem(
    "mayday.workspace.tabs.101",
    JSON.stringify(["/admin", "/admin/users", designer]),
  );
  const { router } = mount(`${designer}?id=23`);
  await screen.findByText("流程记录 23");
  fireEvent.click(screen.getByRole("tab", { name: "用户管理" }));
  await screen.findByText("用户页内容");
  fireEvent.click(screen.getByRole("tab", { name: "流程设计" }));
  await screen.findByText("流程记录 23");
  fireEvent.keyDown(screen.getByRole("tab", { name: "流程设计" }), {
    key: "ArrowLeft",
  });
  await screen.findByText("用户页内容");
  fireEvent.click(screen.getByRole("button", { name: "刷新流程页签" }));
  await screen.findByText("流程记录 23");
  fireEvent.click(screen.getByRole("tab", { name: "用户管理" }));
  await screen.findByText("用户页内容");
  fireEvent.click(screen.getByRole("button", { name: "关闭活动页" }));
  await screen.findByText("流程记录 23");
  assert.equal(router.state.location.search, "?id=23");
});

test("切换实体更新页签目标，关闭设计页清除目标，重新打开空路由不恢复旧实体", async () => {
  const { router } = mount(`${designer}?id=23`);
  await screen.findByText("流程记录 23");
  fireEvent.click(screen.getByRole("button", { name: "打开另一流程" }));
  await screen.findByText("流程记录 27");
  await waitFor(() =>
    assert.deepEqual(
      JSON.parse(sessionStorage.getItem("mayday.workspace.tabs.101.targets")!),
      { [designer]: `${designer}?id=27` },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "关闭活动页" }));
  await screen.findByText("工作台内容");
  await waitFor(() =>
    assert.deepEqual(
      JSON.parse(sessionStorage.getItem("mayday.workspace.tabs.101.targets")!),
      {},
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "打开空流程设计" }));
  await screen.findByText("尚未选择流程");
  assert.equal(router.state.location.search, "");
});

test("刷新后恢复已打开实体页签，权限撤回同步销毁安全实体目标", async () => {
  sessionStorage.setItem(
    "mayday.workspace.tabs.101",
    JSON.stringify(["/admin", designer]),
  );
  sessionStorage.setItem(
    "mayday.workspace.tabs.101.targets",
    JSON.stringify({ [designer]: `${designer}?id=23&schema=secret` }),
  );
  const { router } = mount("/admin");
  await screen.findByText("工作台内容");
  fireEvent.click(screen.getByRole("tab", { name: "流程设计" }));
  await screen.findByText("流程记录 23");
  assert.equal(router.state.location.search, "?id=23");
  permissions = ["dashboard:view", "users:view"];
  fireEvent.click(screen.getByRole("button", { name: "更新身份" }));
  await waitFor(() =>
    assert.equal(
      Boolean(screen.queryByRole("tab", { name: "流程设计" })),
      false,
    ),
  );
  await waitFor(() =>
    assert.deepEqual(
      JSON.parse(sessionStorage.getItem("mayday.workspace.tabs.101.targets")!),
      {},
    ),
  );
});

test("登录状态中的外链和无效 ID 不能绕过白名单返回地址", async () => {
  for (const [requested, expected] of [
    ["https://example.com/admin/users", "/admin"],
    ["//example.com/admin/users", "/admin"],
    ["/admin/not-a-page?id=23", "/admin"],
    [`${designer}?id=-1&token=secret`, designer],
  ]) {
    const view = mount({ pathname: "/login", state: { from: requested } });
    await waitFor(() =>
      assert.equal(view.router.state.location.pathname, expected),
    );
    assert.equal(view.router.state.location.search, "");
    view.unmount();
    view.router.dispose();
  }
});
