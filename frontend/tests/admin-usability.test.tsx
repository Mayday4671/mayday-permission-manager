import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";

// 组件单元环境，无真实浏览器或业务数据；不作为视觉验收证据。
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
  "StorageEvent",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}
globalThis.innerWidth = 1366;
globalThis.innerHeight = 800;
globalThis.scrollX = 0;
globalThis.scrollY = 0;
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Ant 的 MessageChannel 在浏览器无需销毁；Node 测试结束时关闭本环境创建的端口。
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
const { useState } = React;
const { render, screen, waitFor, cleanup, within, act, fireEvent } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { ConfigProvider, App, Form, Input, Button } = await import("antd");
const { createMemoryRouter, RouterProvider, Routes, Route, Link } =
  await import("react-router-dom");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { ModulesProvider } = await import("../src/lib/modules");
const { WorkspaceProvider, useWorkspace } =
  await import("../src/lib/workspace");
const { ResourcePage } = await import("../src/components/ResourcePage");
const { FormModal } = await import("../src/components/FormModal");
const { NodeEditor } = await import("../src/components/workflow/NodeEditor");
const { FieldEditor } = await import("../src/components/workflow/FieldEditor");
const { WorkflowFields, encodeWorkflowValues } =
  await import("../src/components/WorkflowFields");
const { FormDrawer } = await import("../src/components/FormDrawer");
const { AppearanceProvider } = await import("../src/lib/theme");
const { AdminThemeButton, ThemeFormContent } =
  await import("../src/components/ThemeEditor");
const { ADMIN_APPEARANCE, PORTAL_APPEARANCE } =
  await import("../src/lib/theme-model");
let activeId = 1;
let requests = [];
let clients = [];
let routers = [];
const crawlerPayloads = [];
let serverRows = [
  { id: 1, name: "Alpha", enabled: true, version: 1 },
  { id: 2, name: "Beta", enabled: false, version: 1 },
];
globalThis.fetch = async (path, options) => {
  const url = new URL(
    path instanceof Request ? path.url : String(path),
    "http://localhost",
  );
  if (url.pathname === "/api/platform/features")
    return Response.json({
      success: true,
      data: {
        modules: {
          content: true,
          portal: true,
          notifications: true,
          approvals: true,
          crawler: true,
          udp: true,
          scheduler: true,
          workorders: false,
        },
      },
    });
  if (url.pathname === "/api/auth/me")
    return Response.json({
      success: true,
      data: {
        user: { id: activeId, nickname: "测试账号" },
        permissions: [
          "dashboard:view",
          "users:view",
          "users:create",
          "users:update",
          "roles:view",
          "crawler:view",
          "crawler:create",
          "crawler:run",
          "crawler:download",
          "files:create",
        ],
        dataScopes: { users: "ALL" },
        admin: true,
      },
    });
  if (
    url.pathname === "/api/crawler/tasks" ||
    url.pathname === "/api/crawler/tasks/articles"
  ) {
    if (options?.method === "POST") {
      crawlerPayloads.push(JSON.parse(options.body));
      return Response.json({ success: true, data: { id: 50 } });
    }
    return Response.json({
      success: true,
      data: { items: [], total: 0, page: 1, size: 10 },
    });
  }
  requests.push(url.searchParams);
  const rows = serverRows.filter(
    (row) =>
      !url.searchParams.get("keyword") ||
      row.name.includes(url.searchParams.get("keyword")),
  );
  return Response.json({
    success: true,
    data: { items: rows, total: rows.length, page: 1, size: 10 },
  });
};
function Gate({ children }) {
  const { session } = useAuth();
  return session ? (
    <WorkspaceProvider key={session.user.id}>{children}</WorkspaceProvider>
  ) : null;
}
function WorkspaceControls() {
  const workspace = useWorkspace();
  return (
    <>
      <Link to="/admin/roles">切换角色页</Link>
      <Button onClick={() => workspace.refresh(workspace.active)}>
        刷新页签
      </Button>
      <Button onClick={() => workspace.close(workspace.active, "current")}>
        关闭当前页签
      </Button>
    </>
  );
}
function mount(page, id = 1) {
  activeId = id;
  sessionStorage.setItem("mayday.session", "unit-test-token");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <QueryClientProvider client={client}>
            <ConfigProvider theme={{ token: { motion: false } }}>
              <App>
                <ModulesProvider>
                  <AuthProvider>
                    <Gate>
                      <WorkspaceControls />
                      <Routes>
                        <Route path="/admin/users" element={page} />
                        <Route
                          path="/admin/roles"
                          element={<div>角色页内容</div>}
                        />
                        <Route path="/admin" element={<div>工作台内容</div>} />
                      </Routes>
                    </Gate>
                  </AuthProvider>
                </ModulesProvider>
              </App>
            </ConfigProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: ["/admin/users"] },
  );
  const view = render(<RouterProvider router={router} />);
  routers.push(router);
  return { ...view, router, client };
}
function List() {
  return (
    <ResourcePage
      resource="users"
      endpoint="/system/users"
      title="用户管理"
      singular="用户"
      statusField="enabled"
      columns={[
        { title: "姓名", dataIndex: "name" },
        {
          title: "状态",
          dataIndex: "enabled",
          render: (value) => (value ? "启用" : "停用"),
        },
      ]}
      fields={() => (
        <Form.Item name="name" label="姓名" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      )}
    />
  );
}
function Editor() {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  return (
    <>
      <Button
        onClick={() => {
          form.setFieldsValue({ name: "原值" });
          setOpen(true);
        }}
      >
        打开编辑
      </Button>
      <FormModal
        open={open}
        form={form}
        title="编辑记录"
        onCancel={() => setOpen(false)}
        onSubmit={async () => setOpen(false)}
      >
        <Form.Item name="name" label="名称">
          <Input />
        </Form.Item>
        <Button onClick={() => form.setFieldValue("name", "程序修改")}>
          恢复默认
        </Button>
      </FormModal>
    </>
  );
}
afterEach(async () => {
  cleanup();
  routers.forEach((router) => router.dispose());
  routers = [];
  clients.forEach((client) => client.clear());
  clients = [];
  localStorage.clear();
  sessionStorage.clear();
  requests = [];
});
after(() => {
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

/** 使用真实 Provider、抽屉、控件和存储，验证预览、提交和保存值的边界。 */
function ThemeHarness({
  portalEditor = false,
  onSave,
}: {
  portalEditor?: boolean;
  onSave?: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  return (
    <AppearanceProvider>
      {portalEditor ? (
        <>
          <Button
            onClick={() => {
              form.setFieldsValue({ appearance: PORTAL_APPEARANCE });
              setOpen(true);
            }}
          >
            配置前台主题
          </Button>
          <FormDrawer
            title="配置前台主题"
            open={open}
            form={form}
            onCancel={() => setOpen(false)}
            onSubmit={async () => {
              await onSave?.();
              setOpen(false);
            }}
          >
            <ThemeFormContent portal drawer />
          </FormDrawer>
        </>
      ) : (
        <AdminThemeButton />
      )}
      <div data-testid="theme-page">业务页面</div>
    </AppearanceProvider>
  );
}

test("后台主题整页即时预览，取消恢复旧值，保存及重载保留配置", async () => {
  localStorage.setItem(
    "mayday.admin.appearance.v1",
    JSON.stringify({
      mode: "light",
      primaryColor: "#245da8",
      borderRadius: 4,
      compact: false,
    }),
  );
  const user = userEvent.setup();
  const view = mount(<ThemeHarness />);
  await user.click(await screen.findByRole("button", { name: "后台主题" }));
  let dialog = screen.getByRole("dialog", { name: "后台主题" });
  assert.ok(dialog.closest(".ant-drawer-right"));
  assert.equal(
    within(dialog).queryByLabelText("主题效果预览"),
    null,
    "后台直接预览整页，不重复显示示例",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "显示模式：深色" }),
  );
  await waitFor(() =>
    assert.equal(document.documentElement.style.colorScheme, "dark"),
  );
  assert.equal(
    JSON.parse(localStorage.getItem("mayday.admin.appearance.v1")!).mode,
    "light",
    "预览不写入持久化值",
  );
  await user.click(within(dialog).getByRole("button", { name: "取 消" }));
  await waitFor(() =>
    assert.equal(document.documentElement.style.colorScheme, "light"),
  );
  await user.click(screen.getByRole("button", { name: "后台主题" }));
  dialog = screen.getByRole("dialog", { name: "后台主题" });
  await user.click(
    within(dialog).getByRole("button", { name: "主题预设：商务" }),
  );
  await waitFor(() =>
    assert.equal(
      document.documentElement.style.getPropertyValue("--app-nav-bg"),
      "#172333",
    ),
  );
  await user.click(within(dialog).getByRole("tab", { name: "图表与状态" }));
  await user.click(
    within(dialog).getByRole("button", { name: "图表色板：柔和" }),
  );
  await waitFor(() =>
    assert.equal(
      document.documentElement.style.getPropertyValue("--app-chart-1"),
      "#6b8de3",
    ),
  );
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() =>
    assert.equal(
      JSON.parse(localStorage.getItem("mayday.admin.appearance.v1")!)
        .chartPalette,
      "soft",
    ),
  );
  const saved = localStorage.getItem("mayday.admin.appearance.v1")!;
  view.unmount();
  mount(<ThemeHarness />);
  await screen.findByRole("button", { name: "后台主题" });
  assert.equal(
    document.documentElement.style.getPropertyValue("--app-chart-1"),
    "#6b8de3",
  );
  assert.equal(localStorage.getItem("mayday.admin.appearance.v1"), saved);
});

test("前台草稿只作用于独立预览，不改变后台主题或保存值；导入未知字段被拒绝", async () => {
  const user = userEvent.setup();
  mount(<ThemeHarness portalEditor />);
  await user.click(await screen.findByRole("button", { name: "配置前台主题" }));
  await user.click(
    await screen.findByRole("button", { name: "主题预设：暖橙" }),
  );
  assert.equal(
    document.documentElement.style.getPropertyValue("--app-primary"),
    ADMIN_APPEARANCE.primaryColor,
  );
  assert.equal(localStorage.getItem("mayday.admin.appearance.v1"), null);
  await user.click(screen.getByRole("tab", { name: "效果预览" }));
  const preview = screen
    .getByLabelText("主题效果预览")
    .closest(".theme-scope")!;
  assert.equal(
    (preview as HTMLElement).style.getPropertyValue("--app-primary"),
    "#d46b08",
  );
  await user.click(screen.getByRole("button", { name: "导入配置" }));
  const dialog = screen.getByRole("dialog", { name: "导入主题配置" });
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "主题 JSON 配置" }),
    {
      target: {
        value: JSON.stringify({ ...PORTAL_APPEARANCE, css: "body{}" }),
      },
    },
  );
  await user.click(within(dialog).getByRole("button", { name: "导 入" }));
  assert.ok(await screen.findByText("主题配置缺少必填字段或含有不支持的字段"));
  assert.equal(
    (preview as HTMLElement).style.getPropertyValue("--app-primary"),
    "#d46b08",
  );
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "主题 JSON 配置" }),
    {
      target: {
        value: JSON.stringify({
          ...PORTAL_APPEARANCE,
          menuStyle: "dark",
          chartPalette: "vivid",
        }),
      },
    },
  );
  await user.click(within(dialog).getByRole("button", { name: "导 入" }));
  await waitFor(() =>
    assert.equal(
      (preview as HTMLElement).style.getPropertyValue("--app-nav-bg"),
      "#172333",
    ),
  );
  assert.equal(
    document.documentElement.style.getPropertyValue("--app-nav-bg"),
    "#ffffff",
  );
  await user.click(screen.getByRole("button", { name: "恢复默认" }));
  await waitFor(() =>
    assert.equal(
      (preview as HTMLElement).style.getPropertyValue("--app-primary"),
      PORTAL_APPEARANCE.primaryColor,
    ),
  );
});

test("前台主题抽屉关闭保护、失败保留草稿和保存期间的关闭锁定", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  let complete: (() => void) | undefined;
  mount(
    <ThemeHarness
      portalEditor
      onSave={async () => {
        attempts++;
        if (attempts === 1) throw new Error("主题保存失败测试");
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
      }}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "配置前台主题" }));
  const drawer = screen.getByRole("dialog", { name: "配置前台主题" });
  await user.click(
    within(drawer).getByRole("button", { name: "主题预设：暖橙" }),
  );
  await user.click(within(drawer).getByRole("button", { name: "取 消" }));
  const warning = await screen.findByRole("dialog", {
    name: "放弃未保存的修改？",
  });
  await user.click(within(warning).getByRole("button", { name: "继续编辑" }));
  assert.equal(
    within(drawer)
      .getByRole("button", { name: "主题预设：暖橙" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await user.click(within(drawer).getByRole("button", { name: "保 存" }));
  assert.ok(await screen.findByText("主题保存失败测试"));
  assert.equal(attempts, 1);
  assert.equal(
    within(drawer)
      .getByRole("button", { name: "主题预设：暖橙" })
      .getAttribute("aria-pressed"),
    "true",
  );
  await user.click(within(drawer).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert.ok(complete));
  assert.ok(
    within(drawer)
      .getByRole("button", { name: "主题预设：暖橙" })
      .matches(":disabled"),
  );
  assert.equal(
    (within(drawer).getByRole("button", { name: "取 消" }) as HTMLButtonElement)
      .disabled,
    true,
  );
  await user.click(within(drawer).getByRole("button", { name: "取 消" }));
  assert.ok(screen.getByRole("dialog", { name: "配置前台主题" }) === drawer);
  await act(async () => complete!());
  await waitFor(() =>
    assert.ok(screen.queryByRole("dialog", { name: "配置前台主题" }) === null),
  );
  assert.equal(attempts, 2);
});

test("清空搜索输入后立即清除已提交条件，不必再次查询", async () => {
  const user = userEvent.setup();
  mount(<List />);
  const input = await screen.findByRole("textbox", { name: "搜索用户" });
  await user.type(input, "Alpha{Enter}");
  await waitFor(() => assert.equal(requests.at(-1).get("keyword"), "Alpha"));
  await user.clear(input);
  await waitFor(() => assert.equal(requests.at(-1).has("keyword"), false));
});

test("常用查询保存后可重载应用，并按账号隔离", async () => {
  const user = userEvent.setup();
  const view = mount(<List />);
  const input = await screen.findByRole("textbox", { name: "搜索用户" });
  await user.type(input, "Alpha");
  await user.click(screen.getByRole("button", { name: "常用查询" }));
  await user.click(await screen.findByRole("button", { name: "保存当前条件" }));
  await user.type(
    await screen.findByRole("textbox", { name: "查询名称" }),
    "查 Alpha",
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "保存常用查询" })).getByRole(
      "button",
      { name: "保 存" },
    ),
  );
  await waitFor(() =>
    assert.ok(
      [...Object.values(localStorage)].some((value) =>
        value.includes("查 Alpha"),
      ),
    ),
  );
  view.unmount();
  mount(<List />);
  await user.click(await screen.findByRole("button", { name: "常用查询" }));
  await user.click(await screen.findByRole("button", { name: "查 Alpha" }));
  await waitFor(() =>
    assert.equal(
      screen.getByRole("textbox", { name: "搜索用户" }).value,
      "Alpha",
    ),
  );
  cleanup();
  mount(<List />, 2);
  await user.click(await screen.findByRole("button", { name: "常用查询" }));
  assert.ok(await screen.findByText("尚未保存查询"));
});

test("列显隐跨重载保留，恢复默认列可撤销设置", async () => {
  const user = userEvent.setup();
  const view = mount(<List />);
  await user.click(await screen.findByRole("button", { name: "设置表格列" }));
  await user.click(screen.getByRole("checkbox", { name: "状态" }));
  view.unmount();
  mount(<List />);
  await screen.findByRole("textbox", { name: "搜索用户" });
  assert.equal(screen.queryByRole("columnheader", { name: "状态" }), null);
  await user.click(screen.getByRole("button", { name: "设置表格列" }));
  await user.click(screen.getByRole("button", { name: "恢复默认列" }));
  assert.ok(await screen.findByRole("columnheader", { name: "状态" }));
});

test("程序设置字段也触发关闭提醒，取消后输入保留", async () => {
  const user = userEvent.setup();
  mount(<Editor />);
  await user.click(await screen.findByRole("button", { name: "打开编辑" }));
  await user.click(screen.getByRole("button", { name: "恢复默认" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "编辑记录" })).getByRole(
      "button",
      { name: "取 消" },
    ),
  );
  await user.click(await screen.findByRole("button", { name: "继续编辑" }));
  assert.equal(screen.getByRole("textbox", { name: "名称" }).value, "程序修改");
  const beforeUnload = new dom.window.Event("beforeunload", {
    cancelable: true,
  });
  window.dispatchEvent(beforeUnload);
  assert.equal(beforeUnload.defaultPrevented, true);
});

test("未修改的弹窗关闭不提醒，改动后路由切换确认只出现一次", async () => {
  const user = userEvent.setup();
  const { router } = mount(<Editor />);
  await user.click(await screen.findByRole("button", { name: "打开编辑" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "编辑记录" })).getByRole(
      "button",
      { name: "取 消" },
    ),
  );
  assert.equal(screen.queryByText("放弃未保存的修改？"), null);
  await user.click(screen.getByRole("button", { name: "打开编辑" }));
  await user.type(screen.getByRole("textbox", { name: "名称" }), "改");
  await act(async () => {
    void router.navigate("/admin/roles");
  });
  await user.click(await screen.findByRole("button", { name: "继续编辑" }));
  assert.equal(router.state.location.pathname, "/admin/users");
  await act(async () => {
    void router.navigate("/admin/roles");
  });
  await user.click(await screen.findByRole("button", { name: "放弃修改" }));
  assert.ok(await screen.findByText("角色页内容"));
  assert.equal(screen.queryByText("放弃未保存的修改？"), null);
});

test("关闭编辑页签只确认一次，取消时保留页签与表单", async () => {
  const user = userEvent.setup();
  const { router } = mount(<Editor />);
  await user.click(await screen.findByRole("button", { name: "打开编辑" }));
  await user.type(screen.getByRole("textbox", { name: "名称" }), "改");
  fireEvent.click(screen.getByRole("button", { name: "关闭当前页签" }));
  await user.click(await screen.findByRole("button", { name: "继续编辑" }));
  assert.equal(router.state.location.pathname, "/admin/users");
  fireEvent.click(screen.getByRole("button", { name: "关闭当前页签" }));
  await user.click(await screen.findByRole("button", { name: "放弃修改" }));
  assert.ok(await screen.findByText("工作台内容"));
});

test("正在提交的表单阻止离开，保存成功关闭后允许导航", async () => {
  let finish;
  function SavingEditor() {
    const [form] = Form.useForm();
    const [open, setOpen] = useState(true);
    return (
      <FormModal
        title="提交测试"
        form={form}
        open={open}
        onCancel={() => setOpen(false)}
        onSubmit={async () => {
          await new Promise((resolve) => {
            finish = resolve;
          });
          setOpen(false);
        }}
      >
        <Form.Item label="名称" name="name">
          <Input />
        </Form.Item>
      </FormModal>
    );
  }
  const user = userEvent.setup();
  const { router } = mount(<SavingEditor />);
  await user.type(await screen.findByRole("textbox", { name: "名称" }), "修改");
  await user.click(
    within(screen.getByRole("dialog", { name: "提交测试" })).getByRole(
      "button",
      { name: "保 存" },
    ),
  );
  await waitFor(() => assert.equal(typeof finish, "function"));
  await act(async () => {
    void router.navigate("/admin/roles");
  });
  assert.ok(await screen.findByText("正在保存，请稍候再离开"));
  assert.equal(router.state.location.pathname, "/admin/users");
  await act(async () => {
    finish();
  });
  await waitFor(() =>
    assert.equal(screen.queryByRole("dialog", { name: "提交测试" }), null),
  );
  await act(async () => {
    await router.navigate("/admin/roles");
  });
  assert.ok(await screen.findByText("角色页内容"));
});

test("常用查询被本地篡改也不能恢复额外权限参数", async () => {
  const { preferenceKey } = await import("../src/lib/list-preferences");
  localStorage.setItem(
    preferenceKey(1, "/admin/users", "/system/users..savedQueries"),
    JSON.stringify([
      {
        id: "test",
        name: "被篡改的查询",
        keyword: "Alpha",
        extra: { endpoint: "/admin", role: "admin", scope: "ALL" },
      },
    ]),
  );
  const user = userEvent.setup();
  mount(<List />);
  await user.click(await screen.findByRole("button", { name: "常用查询" }));
  await user.click(await screen.findByRole("button", { name: "被篡改的查询" }));
  await waitFor(() => assert.equal(requests.at(-1).get("keyword"), "Alpha"));
  assert.equal(requests.at(-1).has("role"), false);
  assert.equal(requests.at(-1).has("scope"), false);
  assert.equal(requests.at(-1).has("endpoint"), false);
});

test("采集表单保存包含未显示的分页默认值，列表和详情规则相互独立", async () => {
  const { CrawlConfigPage } =
    await import("../src/pages/operations/CrawlConfigPage");
  const { defaultCrawlRules } = await import("../src/types/crawler");
  const user = userEvent.setup();
  crawlerPayloads.length = 0;
  mount(<CrawlConfigPage />);
  assert.ok(await screen.findByRole("table"));
  assert.equal(screen.queryByRole("searchbox", { name: "搜索采集文章" }), null);
  assert.equal(screen.queryByText("图片卡片", { exact: true }), null);
  await user.click(await screen.findByRole("button", { name: "新增配置" }));
  const dialog = await screen.findByRole("dialog", { name: "新增采集配置" });
  await user.type(within(dialog).getByLabelText("配置名称"), "表单回归");
  await user.type(
    within(dialog).getByLabelText("入口页面 / 接口地址"),
    "https://example.com/gallery",
  );
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert.equal(crawlerPayloads.length, 1));
  const expected = defaultCrawlRules();
  expected.entryUrl = "https://example.com/gallery";
  assert.deepEqual(crawlerPayloads[0], { name: "表单回归", rules: expected });
  assert.notEqual(expected.list, expected.detail);
  await waitFor(() =>
    assert.equal(screen.queryByRole("dialog", { name: "新增采集配置" }), null),
  );
});

test("采集数据只请求数据，不挂载配置或执行记录；两个菜单保留独立页签", async () => {
  const { CrawlDataPage } =
    await import("../src/pages/operations/CrawlDataPage");
  const { adminPages, normalizeTabs } =
    await import("../src/lib/workspace-model");
  const original = globalThis.fetch,
    seen = [];
  globalThis.fetch = (path, options) => {
    seen.push(String(path));
    return original(path, options);
  };
  try {
    mount(<CrawlDataPage />);
    assert.ok(await screen.findByText("暂无采集数据"));
    assert.equal(screen.queryByRole("table"), null);
    assert.equal(screen.queryByRole("button", { name: "新增配置" }), null);
    assert.equal(screen.queryByText("任务管理"), null);
    assert(seen.some((url) => url.includes("/crawler/tasks/articles?")));
    assert(!seen.some((url) => /\/crawler\/tasks(?:\?|$)/.test(url)));
    const paths = ["/admin/crawler", "/admin/crawler-config"];
    assert.deepEqual(
      paths.map((path) => adminPages.find((p) => p.path === path).title),
      ["采集数据", "采集配置"],
    );
    assert.deepEqual(normalizeTabs(paths, paths, "/admin"), [
      "/admin",
      ...paths,
    ]);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

test("UDP 是独立菜单，系统管理折叠不影响它的访问", async () => {
  const { AdminNavigation } = await import("../src/components/AdminNavigation");
  const items = [
    { id: 901, path: "/admin/udp-relay", name: "UDP 转发" },
    { id: 902, path: "/admin/users", name: "用户管理" },
  ];
  const router = createMemoryRouter(
    [{ path: "*", element: <AdminNavigation items={items} compact={false} /> }],
    { initialEntries: ["/admin/udp-relay"] },
  );
  try {
    render(<RouterProvider router={router} />);
    const link = screen.getByRole("link", { name: "UDP 转发" });
    assert.equal(link.closest(".nav-group"), null);
    assert.equal(
      screen
        .getByRole("button", { name: "系统管理" })
        .getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(link.getAttribute("aria-current"), "page");
  } finally {
    cleanup();
    router.dispose();
  }
});

test("客户反馈使用授权导航入口，点击客户服务名称即可展开和折叠整组", async () => {
  const { AdminNavigation } = await import("../src/components/AdminNavigation");
  const items = [
    {
      id: 910,
      path: "/admin/feedback",
      name: "客户反馈",
      permission: "feedback:view",
    },
    {
      id: 911,
      path: "/admin/users",
      name: "用户管理",
      permission: "users:view",
    },
  ];
  const router = createMemoryRouter(
    [{ path: "*", element: <AdminNavigation items={items} compact={false} /> }],
    { initialEntries: ["/admin"] },
  );
  try {
    render(<RouterProvider router={router} />);
    const customerGroup = screen.getByRole("button", { name: "客户服务" });
    const user = userEvent.setup();
    assert.equal(customerGroup.getAttribute("aria-expanded"), "false");
    assert.equal(screen.queryByRole("link", { name: "客户反馈" }), null);
    // 直接点组名称文字，证明整行按钮负责折叠，不要求用户寻找小箭头或图标。
    await user.click(within(customerGroup).getByText("客户服务"));
    assert.equal(customerGroup.getAttribute("aria-expanded"), "true");
    assert.equal(
      screen.getByRole("link", { name: "客户反馈" }).getAttribute("href"),
      "/admin/feedback",
    );
    await user.click(within(customerGroup).getByText("客户服务"));
    assert.equal(customerGroup.getAttribute("aria-expanded"), "false");
    assert.equal(screen.queryByRole("link", { name: "客户反馈" }), null);
    // 进入反馈路由后自动定位客户服务组，但不会擅自展开其他组。
    await act(() => router.navigate("/admin/feedback"));
    assert.equal(customerGroup.getAttribute("aria-expanded"), "true");
    assert.equal(
      screen
        .getByRole("link", { name: "客户反馈" })
        .getAttribute("aria-current"),
      "page",
    );
    assert.equal(
      screen
        .getByRole("button", { name: "系统管理" })
        .getAttribute("aria-expanded"),
      "false",
    );
  } finally {
    cleanup();
    router.dispose();
  }
});

test("未授权客户反馈不因前端页面登记出现，整个空客户服务分组也不显示", async () => {
  const { AdminNavigation } = await import("../src/components/AdminNavigation");
  // 导航接口未返回反馈入口；即使地址栏指向该路由，展示层也不能自行补出权限入口。
  const items = [
    {
      id: 911,
      path: "/admin/users",
      name: "用户管理",
      permission: "users:view",
    },
  ];
  const router = createMemoryRouter(
    [{ path: "*", element: <AdminNavigation items={items} compact={false} /> }],
    { initialEntries: ["/admin/feedback"] },
  );
  try {
    render(<RouterProvider router={router} />);
    assert.equal(screen.queryByRole("button", { name: "客户服务" }), null);
    assert.equal(
      screen.queryByRole("link", { name: "客户反馈", hidden: true }),
      null,
    );
    assert.ok(screen.getByRole("button", { name: "系统管理" }));
  } finally {
    cleanup();
    router.dispose();
  }
});

test("缩窄侧栏仍可通过客户服务快捷菜单访问已授权反馈", async () => {
  const { AdminNavigation } = await import("../src/components/AdminNavigation");
  const items = [
    {
      id: 910,
      path: "/admin/feedback",
      name: "客户反馈",
      permission: "feedback:view",
    },
  ];
  const router = createMemoryRouter(
    [{ path: "*", element: <AdminNavigation items={items} compact /> }],
    { initialEntries: ["/admin"] },
  );
  try {
    render(<RouterProvider router={router} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "客户服务" }));
    assert.equal(
      (await screen.findByRole("link", { name: "客户反馈" })).getAttribute(
        "href",
      ),
      "/admin/feedback",
    );
  } finally {
    cleanup();
    router.dispose();
  }
});

test("UDP 页面配置真实提交，启停使用版本与批次，未知系统丢包不显示零", async () => {
  const { UdpRelayPage } = await import("../src/pages/operations/UdpRelayPage");
  const original = globalThis.fetch,
    sent = [];
  let config = {
    id: 1,
    version: 0,
    bindIp: "0.0.0.0",
    bindPort: 19000,
    targetIp: "127.0.0.1",
    targetPort: 19001,
    receiveBufferMiB: 16,
    sendBufferMiB: 16,
    pendingMemoryMiB: 64,
    sendIp: "127.0.0.1",
    sendPort: 19003,
    transportMode: "NIO",
  };
  let stats = {
    runId: "",
    state: "STOPPED",
    transport: "NIO",
    startedAt: null,
    sampledAt: "2026-09-22T14:00:00Z",
    receivedPackets: 1000,
    forwardedPackets: 997,
    pendingPackets: 0,
    invalidPackets: 1,
    overflowPackets: 0,
    sendFailures: 2,
    receiveErrors: 0,
    kernelDrops: null,
    receiveMbps: 250,
    forwardMbps: 249.9,
    receivePps: 22000,
    forwardPps: 21998,
    actualReceiveBuffer: 4194304,
    actualSendBuffer: 4194304,
    lastError: "",
  };
  globalThis.fetch = async (path, options) => {
    const url = new URL(
      path instanceof Request ? path.url : String(path),
      "http://localhost",
    );
    if (url.pathname === "/api/auth/me") {
      const result = await (await original(path, options)).json();
      result.data.permissions.push(
        "relay:view",
        "relay:configure",
        "relay:control",
      );
      return Response.json(result);
    }
    if (url.pathname.startsWith("/api/relay/")) {
      if (url.pathname.endsWith("/interfaces"))
        return Response.json({
          success: true,
          data: [
            {
              name: "lo",
              displayName: "Loopback",
              ip: "127.0.0.1",
              prefixLength: 8,
              mtu: 65536,
              up: true,
              loopback: true,
            },
          ],
        });
      if (options?.method) {
        const body = JSON.parse(options.body);
        sent.push({ path: url.pathname, body });
        if (url.pathname.endsWith("/config"))
          config = { ...config, ...body, version: config.version + 1 };
        if (url.pathname.endsWith("/start"))
          stats = {
            ...stats,
            runId: "run-1",
            state: "RUNNING",
            sampledAt: "2026-09-22T14:00:01Z",
          };
        if (url.pathname.endsWith("/stop"))
          stats = {
            ...stats,
            state: "STOPPED",
            sampledAt: "2026-09-22T14:00:02Z",
          };
      }
      return Response.json({
        success: true,
        data: url.pathname.endsWith("/config") ? config : stats,
      });
    }
    return original(path, options);
  };
  try {
    const user = userEvent.setup();
    mount(<UdpRelayPage />);
    assert.ok(await screen.findByText("不可用"));
    assert.ok(screen.getByText("接收缓冲受限"));
    assert.equal(
      document.querySelectorAll(
        ".udp-relay-metrics .ant-statistic-content-value",
      )[2].textContent,
      "3",
    );
    await user.click(screen.getByRole("button", { name: "配 置" }));
    const dialog = await screen.findByRole("dialog", { name: "UDP 转发配置" });
    const port = within(dialog).getByRole("spinbutton", { name: "接收端口" });
    await user.clear(port);
    await user.type(port, "19002");
    await user.click(within(dialog).getByRole("button", { name: "保 存" }));
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("dialog", { name: "UDP 转发配置" }),
        null,
      ),
    );
    assert.equal(sent[0].body.bindPort, 19002);
    assert.equal(sent[0].body.version, 0);
    assert.equal(sent[0].body.receiveBufferMiB, 16);
    assert.equal(sent[0].body.sendIp, "127.0.0.1");
    assert.equal(sent[0].body.sendPort, 19003);
    assert.equal(sent[0].body.transportMode, "NIO");
    await user.click(screen.getByRole("button", { name: "启动转发" }));
    await waitFor(() =>
      assert.equal(
        screen.getByRole("button", { name: "配 置" }).disabled,
        true,
      ),
    );
    assert.deepEqual(sent.find((r) => r.path.endsWith("/start")).body, {
      version: 1,
    });
    await user.click(screen.getByRole("button", { name: "停止转发" }));
    await waitFor(() =>
      assert.equal(
        screen.getByRole("button", { name: "配 置" }).disabled,
        false,
      ),
    );
    assert.deepEqual(sent.find((r) => r.path.endsWith("/stop")).body, {
      runId: "run-1",
    });
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

test("UDP 只读账号页面不显示配置与控制操作", async () => {
  const { UdpRelayPage } = await import("../src/pages/operations/UdpRelayPage");
  const original = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    const url = new URL(
      path instanceof Request ? path.url : String(path),
      "http://localhost",
    );
    if (url.pathname === "/api/auth/me") {
      const result = await (await original(path, options)).json();
      result.data.permissions = ["relay:view"];
      return Response.json(result);
    }
    if (url.pathname.startsWith("/api/relay/"))
      return Response.json({
        success: true,
        data: url.pathname.endsWith("/config")
          ? {
              bindIp: "127.0.0.1",
              bindPort: 19000,
              targetIp: "127.0.0.1",
              targetPort: 19001,
              version: 0,
            }
          : {
              state: "STOPPED",
              runId: "",
              sampledAt: "2026-09-22T14:00:00Z",
              kernelDrops: null,
            },
      });
    return original(path, options);
  };
  try {
    mount(<UdpRelayPage />);
    assert.ok(await screen.findByText("不可用"));
    assert.equal(screen.queryByRole("button", { name: "配 置" }), null);
    assert.equal(screen.queryByRole("button", { name: "启动转发" }), null);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

test("执行记录按弹窗高度请求整页，缩放保留位置且筛选和结果缩减不留下空页", async () => {
  const { CrawlExecutionRecords } =
    await import("../src/components/CrawlExecutionRecords");
  const originalFetch = globalThis.fetch;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalHeight = window.innerHeight;
  const style = document.createElement("style");
  // jsdom 不执行布局；仅替代几何测量，使用真实弹窗、DataTable 和分页交互。
  style.textContent =
    ".form-modal-body{padding-bottom:20px!important}.crawl-execution-results .ant-pagination{margin:12px 0 0!important}";
  document.head.appendChild(style);
  const rect = (top = 0, height = 0) => ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 1000,
    bottom: top + height,
    width: 1000,
    height,
    toJSON() {},
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("ant-modal-body")) return rect(100, 800);
    if (this.classList.contains("crawl-execution-results"))
      return rect(240, 600);
    if (
      this.classList.contains("ant-modal-header") ||
      this.classList.contains("ant-modal-footer")
    )
      return rect(0, 60);
    if (this.classList.contains("ant-table-thead")) return rect(0, 40);
    if (this.classList.contains("ant-table-row")) return rect(0, 64);
    if (this.classList.contains("ant-pagination")) return rect(0, 32);
    return originalRect.call(this);
  };
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 1080,
  });
  const seen = [];
  const all = Array.from({ length: 77 }, (_, index) => ({
    id: index + 1,
    url: `https://images.example/${"long-address-".repeat(35)}${index + 1}.jpg`,
    sourceUrl: `https://source.example/${index + 1}`,
    title: "",
    status: "SUCCESS",
    bytes: 1000,
    attempts: 1,
    error: index === 0 ? "完整错误说明".repeat(30) : null,
  }));
  let total = all.length;
  globalThis.fetch = async (path, options) => {
    const url = new URL(
      path instanceof Request ? path.url : String(path),
      "http://localhost",
    );
    if (url.pathname === "/api/crawler/tasks/15")
      return Response.json({
        success: true,
        data: {
          id: 15,
          name: "执行记录尺寸检查",
          status: "COMPLETED",
          pageCount: 3,
          imageCount: 77,
          totalBytes: 10000,
        },
      });
    if (url.pathname === "/api/crawler/tasks/15/items") {
      const page = Number(url.searchParams.get("page")),
        size = Number(url.searchParams.get("size"));
      seen.push({ page, size, kind: url.searchParams.get("kind") });
      return Response.json({
        success: true,
        data: {
          total,
          page,
          size,
          items: all.slice(0, total).slice((page - 1) * size, page * size),
        },
      });
    }
    return originalFetch(path, options);
  };
  try {
    const user = userEvent.setup();
    function Records() {
      const [open, setOpen] = useState(true);
      return open ? (
        <CrawlExecutionRecords id={15} close={() => setOpen(false)} />
      ) : (
        <span>已关闭记录</span>
      );
    }
    mount(<Records />);
    const dialog = await screen.findByRole("dialog", { name: "执行记录" });
    await waitFor(() =>
      assert.equal(dialog.querySelectorAll(".ant-table-row").length, 10),
    );
    assert.equal(
      dialog
        .querySelector(".crawl-record-line[title^='https://images']")
        .getAttribute("title"),
      all[0].url,
      "省略网址仍保留完整值",
    );
    assert.equal(
      dialog.querySelector(".crawl-record-note").getAttribute("title"),
      all[0].error,
    );
    await user.click(within(dialog).getByTitle("2"));
    await waitFor(() =>
      assert.equal(
        dialog.querySelector(".ant-table-row .table-sequence").textContent,
        "11",
      ),
    );
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 768,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      assert.deepEqual(seen.at(-1), { page: 3, size: 5, kind: "IMAGE" }),
    );
    await waitFor(() =>
      assert.equal(dialog.querySelectorAll(".ant-table-row").length, 5),
    );
    assert.equal(
      dialog.querySelector(".ant-table-row .table-sequence").textContent,
      "11",
    );
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 640,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      assert.deepEqual(seen.at(-1), { page: 4, size: 3, kind: "IMAGE" }),
    );
    await waitFor(() =>
      assert.equal(dialog.querySelectorAll(".ant-table-row").length, 3),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "记录类型" }),
    );
    await user.click(
      await screen.findByText("详情页", {
        selector: ".ant-select-item-option-content",
      }),
    );
    await waitFor(() =>
      assert.deepEqual(seen.at(-1), { page: 1, size: 3, kind: "DETAIL" }),
    );
    await user.click(within(dialog).getByTitle("2"));
    await waitFor(() =>
      assert.equal(
        dialog.querySelector(".ant-table-row .table-sequence").textContent,
        "4",
      ),
    );
    total = 2;
    await user.click(within(dialog).getByRole("button", { name: "刷 新" }));
    await waitFor(() =>
      assert.equal(dialog.querySelectorAll(".ant-table-row").length, 2),
    );
    assert.equal(
      dialog.querySelector(".ant-table-row .table-sequence").textContent,
      "1",
    );
    await user.click(within(dialog).getByRole("button", { name: "关 闭" }));
    assert.ok(await screen.findByText("已关闭记录"));
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    style.remove();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
    });
  }
});

test("卡片按窗口容量请求服务端分页，窗口缩小时保留原来浏览位置", async () => {
  const { CrawlArticleCards } =
    await import("../src/components/CrawlArticleCards");
  const originalFetch = globalThis.fetch;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalHeight = window.innerHeight;
  let width = 1610;
  const seenPages = [];
  const all = Array.from({ length: 37 }, (_, index) => ({
    id: index + 1,
    taskId: 5,
    taskName: "尺寸测试",
    taskStatus: "COMPLETED",
    title: `尺寸文章 ${index + 1}`,
    sourceUrl: "https://source.example/" + index,
    collectedAt: "2026-09-22T10:00:00",
    pageCount: 1,
    imageCount: 0,
    pendingImages: 0,
    failedImages: 0,
  }));
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains("crawl-cards-viewport"))
      return {
        x: 0,
        y: 220,
        top: 220,
        left: 0,
        right: width,
        bottom: 220,
        width,
        height: 0,
        toJSON() {},
      };
    if (this.classList.contains("crawl-pagination"))
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 32,
        width,
        height: 32,
        toJSON() {},
      };
    return originalRect.call(this);
  };
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 1000,
  });
  globalThis.fetch = async (path, options) => {
    const url = new URL(
      path instanceof Request ? path.url : String(path),
      "http://localhost",
    );
    if (url.pathname === "/api/crawler/tasks/articles") {
      const page = Number(url.searchParams.get("page")),
        size = Number(url.searchParams.get("size"));
      seenPages.push({ page, size });
      return Response.json({
        success: true,
        data: {
          page,
          size,
          total: all.length,
          items: all.slice((page - 1) * size, page * size),
        },
      });
    }
    return originalFetch(path, options);
  };
  try {
    const user = userEvent.setup();
    mount(<CrawlArticleCards active={false} />);
    await waitFor(() =>
      assert.equal(
        screen.getAllByRole("button", { name: /尺寸文章/ }).length,
        21,
      ),
    );
    assert.equal(
      document
        .querySelector(".crawl-article-grid")
        .style.getPropertyValue("--crawl-card-height"),
      "240px",
    );
    await user.click(within(screen.getByLabelText("文章分页")).getByTitle("2"));
    assert.ok(await screen.findByRole("button", { name: /尺寸文章 22 / }));
    width = 1010;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() =>
      assert.equal(
        screen.getAllByRole("button", { name: /尺寸文章/ }).length,
        8,
      ),
    );
    assert.equal(
      document
        .querySelector(".crawl-article-grid")
        .style.getPropertyValue("--crawl-card-height"),
      "260px",
      "行高变化需要同步到实际卡片样式",
    );
    assert.ok(screen.getByRole("button", { name: /尺寸文章 22 / }));
    assert.deepEqual(seenPages.at(-1), { page: 3, size: 8 });
    await user.click(within(screen.getByLabelText("文章分页")).getByTitle("5"));
    assert.ok(await screen.findByRole("button", { name: /尺寸文章 37 / }));
    assert.equal(screen.getAllByRole("button", { name: /尺寸文章/ }).length, 5);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
    });
  }
});

test("抽屉图片分页不漏图，跨页放大保持绝对序号且正文按需打开", async () => {
  const { CrawlArticleCards } =
    await import("../src/components/CrawlArticleCards");
  const original = globalThis.fetch;
  const seen = [];
  let finished = false;
  const article = {
    id: 9,
    taskId: 5,
    taskName: "文章测试",
    taskStatus: "COMPLETED",
    imageLimit: 50,
    title: "卡片文章",
    summary: "真实正文摘要",
    author: "来源作者",
    publishedAt: "2026-09-22",
    sourceUrl: "https://source.example/article/9",
    collectedAt: "2026-09-22T10:30:00",
    pageCount: 2,
    imageCount: 32,
    pendingImages: 0,
    failedImages: 0,
    coverItemId: 99,
  };
  globalThis.fetch = async (path, options) => {
    const url = new URL(
      path instanceof Request ? path.url : String(path),
      "http://localhost",
    );
    seen.push({ url, options });
    if (url.pathname === "/api/crawler/tasks/5/articles")
      return Response.json({
        success: true,
        data: {
          items: [
            finished
              ? article
              : {
                  ...article,
                  coverItemId: undefined,
                  imageCount: 0,
                  pendingImages: 1,
                },
          ],
          total: 1,
          page: 1,
          size: 12,
        },
      });
    if (url.pathname === "/api/crawler/tasks/5/articles/9")
      return Response.json({
        success: true,
        data: {
          article,
          truncated: false,
          pages: [
            {
              id: 1,
              sourceUrl: article.sourceUrl,
              body: "第一段正文",
              truncated: false,
            },
            {
              id: 2,
              sourceUrl: article.sourceUrl,
              body: "<script>不能执行</script>第二段正文",
              truncated: false,
            },
          ],
          images: Array.from({ length: 32 }, (_, i) => ({
            id: 99 + i,
            fileId: 100 + i,
            bytes: 1,
          })),
        },
      });
    if (/^\/api\/crawler\/tasks\/5\/items\/\d+\/image$/.test(url.pathname))
      return new Response(
        new Blob([new Uint8Array([1])], { type: "image/png" }),
      );
    return original(path, options);
  };
  function FinishingTask() {
    const [active, setActive] = useState(true);
    return (
      <>
        <Button
          onClick={() => {
            finished = true;
            setActive(false);
          }}
        >
          结束采集
        </Button>
        <CrawlArticleCards task={5} active={active} />
      </>
    );
  }
  try {
    const user = userEvent.setup();
    mount(<FinishingTask />);
    assert.ok(await screen.findByText("1 张待采集"));
    await user.click(screen.getByRole("button", { name: "结束采集" }));
    await waitFor(() => assert.equal(screen.queryByText("1 张待采集"), null));
    await user.click(await screen.findByRole("button", { name: /卡片文章/ }));
    const dialog = await screen.findByRole("dialog", { name: "图文详情" });
    assert.ok(dialog.closest(".ant-drawer-right"));
    assert.equal(
      (await within(dialog).findAllByRole("button", { name: /放大查看第/ }))
        .length,
      12,
    );
    assert.ok(within(dialog).getByText("已采集 32 张"));
    assert.equal(
      within(dialog).queryByText("第一段正文"),
      null,
      "图片默认视图不展开长正文",
    );
    await user.click(within(dialog).getByRole("tab", { name: "文章正文" }));
    assert.ok(await within(dialog).findByText("第一段正文"));
    assert.ok(
      await within(dialog).findByText("<script>不能执行</script>第二段正文"),
    );
    assert.equal(dialog.querySelector("script"), null);
    assert.equal(
      within(dialog)
        .getByRole("link", { name: article.sourceUrl })
        .getAttribute("rel"),
      "noopener noreferrer",
    );
    await user.click(within(dialog).getByRole("tab", { name: "图片 (32)" }));
    const pager = within(dialog).getByLabelText("图片分页");
    await user.click(within(pager).getByTitle("2"));
    assert.equal(
      within(dialog).queryByRole("button", { name: "放大查看第 1 张图片" }),
      null,
    );
    assert.equal(
      within(dialog).getAllByRole("button", { name: /放大查看第/ }).length,
      12,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "放大查看第 24 张图片" }),
    );
    assert.ok(await screen.findByText("24 / 32"));
    const viewer = screen.getByRole("dialog", { name: "" });
    await user.click(within(viewer).getByRole("button", { name: "right" }));
    assert.ok(await screen.findByText("25 / 32"), "大图可跨缩略图分页继续切换");
    assert.ok(within(viewer).getByRole("button", { name: "zoomIn" }));
    await user.click(within(viewer).getByRole("button", { name: "close" }));
    assert.ok(screen.getByRole("dialog", { name: "图文详情" }));
    assert.ok(
      within(dialog).getByRole("button", { name: "放大查看第 13 张图片" }),
      "关闭大图后保留缩略图页码",
    );
    await user.click(within(pager).getByTitle("3"));
    assert.equal(
      within(dialog).getAllByRole("button", { name: /放大查看第/ }).length,
      8,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "放大查看第 32 张图片" }),
    );
    assert.ok(await screen.findByText("32 / 32"));
    await waitFor(() =>
      assert.ok(seen.some(({ url }) => url.pathname.endsWith("/image"))),
    );
    assert.ok(seen.every(({ url }) => url.hostname === "localhost"));
    assert.ok(
      seen
        .filter(({ url }) => url.pathname.endsWith("/image"))
        .every(
          ({ options }) =>
            options.headers.Authorization === "Bearer unit-test-token",
        ),
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

// OA 控件和节点弹窗使用真实 Ant 表单；覆盖未注册矩阵字段与初始化离开保护的回归。
test("节点弹窗初始化不提示丢弃，权限矩阵保留未注册字段且可编辑自动包含可读", async () => {
  const user = userEvent.setup();
  let saved;
  const original = {
    id: "review",
    name: "负责人",
    type: "APPROVAL",
    source: "DEPARTMENT_LEADER",
    mode: "ALL",
    next: "end",
    readable: ["memo"],
    writable: [],
    actions: ["APPROVE", "REJECT", "RETURN"],
    conditions: [],
  };
  function NodeHarness() {
    const [node, setNode] = useState(null);
    return (
      <>
        <Button onClick={() => setNode(original)}>配置流程</Button>
        <NodeEditor
          node={node}
          existing
          nodes={[original, { id: "end", name: "结束", type: "END" }]}
          fields={[
            {
              id: "memo",
              label: "说明",
              type: "TEXT",
              required: true,
              width: 24,
            },
          ]}
          onClose={() => setNode(null)}
          onSave={(value) => {
            saved = value;
            setNode(null);
          }}
        />
      </>
    );
  }
  mount(<NodeHarness />);
  await user.click(await screen.findByRole("button", { name: "配置流程" }));
  const dialog = screen.getByRole("dialog", { name: "编辑流程节点" });
  await user.click(within(dialog).getByRole("tab", { name: "字段权限" }));
  assert(within(dialog).getByRole("radio", { name: "只读" }).checked);
  await user.click(within(dialog).getByRole("button", { name: "取 消" }));
  assert.equal(screen.queryByText("放弃未保存的修改？"), null);
  await user.click(screen.getByRole("button", { name: "配置流程" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "编辑流程节点" })).getByRole(
      "tab",
      { name: "字段权限" },
    ),
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "编辑流程节点" }))
      .getByRole("radio", { name: "可编辑" })
      .closest("label"),
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "编辑流程节点" })).getByRole(
      "button",
      { name: "保 存" },
    ),
  );
  await waitFor(() => assert(saved));
  assert.deepEqual(saved.readable, ["memo"]);
  assert.deepEqual(saved.writable, ["memo"]);
});
test("申请明细和日期区间使用同一受控表单，增删行不丢其他行且提交只传业务值", async () => {
  const user = userEvent.setup();
  let submitted;
  const fields = [
    {
      id: "dates",
      label: "日期",
      type: "DATE_RANGE",
      required: true,
      width: 24,
    },
    {
      id: "items",
      label: "明细",
      type: "DETAILS",
      required: true,
      width: 24,
      maxRows: 2,
      columns: [
        { id: "item", label: "项目", type: "TEXT", required: true },
        { id: "amount", label: "金额", type: "MONEY", required: true },
      ],
    },
  ];
  function DetailHarness() {
    const [form] = Form.useForm();
    return (
      <Form
        form={form}
        onFinish={(values) =>
          (submitted = encodeWorkflowValues(fields, values.values))
        }
      >
        <WorkflowFields fields={fields} />
        <Button htmlType="submit">发送申请</Button>
      </Form>
    );
  }
  mount(<DetailHarness />);
  await screen.findByRole("button", { name: "发送申请" });
  fireEvent.change(screen.getByLabelText("开始日期"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("结束日期"), {
    target: { value: "2026-10-02" },
  });
  await user.click(screen.getByRole("button", { name: /添加明细/ }));
  await user.type(screen.getByRole("textbox", { name: "第1行项目" }), "交通");
  await user.type(screen.getByRole("spinbutton", { name: "第1行金额" }), "30");
  await user.click(screen.getByRole("button", { name: /添加明细/ }));
  assert(screen.getByRole("button", { name: /添加明细/ }).disabled);
  await user.type(screen.getByRole("textbox", { name: "第2行项目" }), "住宿");
  await user.type(screen.getByRole("spinbutton", { name: "第2行金额" }), "100");
  await user.click(screen.getByRole("button", { name: "删除第1行" }));
  assert.equal(
    screen.getByRole("textbox", { name: "第1行项目" }).value,
    "住宿",
  );
  await user.click(screen.getByRole("button", { name: "发送申请" }));
  await waitFor(() => assert(submitted));
  assert.deepEqual(submitted, {
    dates: ["2026-10-01", "2026-10-02"],
    items: [{ item: "住宿", amount: 100 }],
  });
});
test("保存草稿跳过必填项但复用提交锁，正式提交仍要求表单完整", async () => {
  const user = userEvent.setup();
  let applicationForm;
  let draftCalls = 0,
    submitCalls = 0;
  function DraftHarness() {
    const [form] = Form.useForm();
    applicationForm = form;
    return (
      <FormModal
        title="申请草稿"
        open
        form={form}
        onCancel={() => {}}
        onSubmit={async () => {
          submitCalls++;
        }}
        secondaryAction={{
          label: "保存草稿",
          onSubmit: async () => {
            draftCalls++;
          },
        }}
      >
        <Form.Item name="memo" label="说明" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </FormModal>
    );
  }
  mount(<DraftHarness />);
  await screen.findByRole("dialog", { name: "申请草稿" });
  await act(async () => {
    await assert.rejects(applicationForm.validateFields());
  });
  assert.equal(submitCalls, 0);
  await user.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.equal(draftCalls, 1));
  await user.type(screen.getByRole("textbox", { name: "说明" }), "正式申请");
  await user.click(screen.getByRole("button", { name: "保 存" }));
  await waitFor(() => assert.equal(submitCalls, 1));
});

test("明细列属性编辑保留模板约束，并允许修改金额上限", async () => {
  const user = userEvent.setup();
  let saved;
  mount(
    <FieldEditor
      existing
      field={{
        id: "items",
        label: "费用明细",
        type: "DETAILS",
        width: 24,
        required: true,
        maxRows: 20,
        columns: [
          { id: "item", label: "项目", type: "TEXT", maxLength: 200 },
          {
            id: "amount",
            label: "金额",
            type: "MONEY",
            min: 0,
            max: 1000,
            required: true,
          },
        ],
      }}
      onClose={() => {}}
      onSave={(value) => {
        saved = value;
      }}
    />,
  );
  const dialog = await screen.findByRole("dialog", { name: "编辑表单字段" });
  await user.click(within(dialog).getByRole("tab", { name: "明细列" }));
  await user.click(within(dialog).getByRole("tab", { name: "第 2 列" }));
  const maximum = within(dialog).getByRole("spinbutton", { name: "最大值" });
  await user.clear(maximum);
  await user.type(maximum, "500");
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert(saved));
  assert.equal(saved.maxRows, 20);
  assert.equal(saved.columns[0].maxLength, 200);
  assert.equal(saved.columns[1].min, 0);
  assert.equal(saved.columns[1].max, 500);
});
