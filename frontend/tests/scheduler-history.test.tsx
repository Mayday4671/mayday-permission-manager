import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";

// 实际 Ant/React 组件与生成契约客户端回归；合成接口不访问服务或数据库，也不替代浏览器视觉验收。
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
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
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
let tableWidth = 1100;
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return this.classList.contains("data-table-container") ? tableWidth : 0;
  },
});
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
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
    queueMicrotask(() => {
      this.port1.unref();
      this.port2.unref();
    });
  }
};

const React = await import("react");
const { render, screen, within, waitFor, cleanup, act } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { ModulesProvider } = await import("../src/lib/modules");
const { WorkspaceProvider } = await import("../src/lib/workspace");
const { SchedulerPage } = await import("../src/pages/operations/SchedulerPage");
const { jobExecutions } = await import("../src/lib/general-platform");
type JobExecution = import("../src/lib/general-platform").JobExecution;

const originalFetch = globalThis.fetch;
const clients = [];
const routers = [];
const calls: { path: string; method: string; query: URLSearchParams }[] = [];
let configurations = [];
let logs: JobExecution[] = [];
let canExecute = false;
let rejectLogs = false;
let incompleteLogs = false;
let rejectControl = false;
function response(data: unknown) {
  return Response.json({ success: true, data });
}
globalThis.fetch = async (input, options) => {
  const address = new URL(
    input instanceof Request ? input.url : String(input),
    "http://localhost",
  );
  const method =
    input instanceof Request ? input.method : (options?.method ?? "GET");
  calls.push({ path: address.pathname, method, query: address.searchParams });
  if (address.pathname === "/api/auth/me")
    return response({
      user: { id: 101, nickname: "验收人员" },
      permissions: [
        "scheduler:view",
        ...(canExecute ? ["scheduler:execute"] : []),
      ],
      dataScopes: {},
      scopeDepartments: {},
      admin: false,
    });
  if (address.pathname === "/api/platform/features")
    return response({ modules: { scheduler: true } });
  if (address.pathname === "/api/operations/scheduler/handlers")
    return response({ DATABASE_CHECK: "数据库健康检查" });
  if (address.pathname === "/api/operations/scheduler/recipients")
    return response([]);
  if (address.pathname === "/api/operations/scheduler")
    return response({
      items: configurations,
      total: configurations.length,
      page: 1,
      size: 10,
    });
  if (address.pathname === "/api/operations/job-logs") {
    if (rejectLogs)
      return Response.json(
        { success: false, message: "记录服务暂时不可用" },
        { status: 503 },
      );
    if (incompleteLogs) return response({ items: [] });
    const page = Number(address.searchParams.get("page")),
      size = Number(address.searchParams.get("size"));
    assert.equal(size, 5, "弹窗保持有限行数，不默认加载全量历史");
    const result = logs.filter(
      (record) =>
        (!address.searchParams.has("jobId") ||
          record.jobId === Number(address.searchParams.get("jobId"))) &&
        record.jobName.includes(address.searchParams.get("keyword") ?? ""),
    );
    return response({
      items: result.slice((page - 1) * size, page * size),
      total: result.length,
      page,
      size,
    });
  }
  const control = address.pathname.match(
    /^\/api\/operations\/job-logs\/(\d+)\/(cancel|retry)$/,
  );
  if (control) {
    assert.equal(method, "POST");
    if (rejectControl)
      return Response.json(
        { success: false, message: "执行状态已变化，请刷新后再操作" },
        { status: 409 },
      );
    const record = logs.find((entry) => entry.id === Number(control[1]));
    assert(record, "只使用执行记录编号控制，不能把配置编号误当记录编号");
    record.status = control[2] === "cancel" ? "CANCELLED" : "QUEUED";
    record.version += 1;
    return response(record);
  }
  throw new Error("未预期的合成接口：" + address.pathname);
};

/** 身份加载后再创建页签上下文，沿用真实页面的查看权限而不注入管理权限。 */
function Gate() {
  const { session } = useAuth();
  return session ? (
    <WorkspaceProvider>
      <SchedulerPage />
    </WorkspaceProvider>
  ) : null;
}
function mount() {
  sessionStorage.setItem("mayday.session", "synthetic-scheduler-session");
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
                    <Gate />
                  </AuthProvider>
                </ModulesProvider>
              </App>
            </ConfigProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: ["/admin/scheduler"] },
  );
  routers.push(router);
  return render(<RouterProvider router={router} />);
}
function seedLogs(total = 12) {
  logs = Array.from({ length: total }, (_, index) => ({
    id: 1000 + index,
    jobId: 404,
    jobName: "已删除的日常维护",
    status: "SUCCESS",
    result: "检查完成 " + index,
    durationMs: 15,
    attempts: 1,
    createdAt: "2026-10-05T10:00:00",
    version: 7,
  }));
}
function logQueries() {
  return calls.filter((call) => call.path === "/api/operations/job-logs");
}
afterEach(async () => {
  cleanup();
  await act(async () => clients.splice(0).forEach((client) => client.clear()));
  routers.splice(0).forEach((router) => router.dispose());
  calls.length = 0;
  configurations = [];
  logs = [];
  canExecute = rejectLogs = incompleteLogs = rejectControl = false;
  tableWidth = 1100;
  localStorage.clear();
  sessionStorage.clear();
});
after(() => {
  globalThis.fetch = originalFetch;
  channels.forEach((channel) => {
    channel.port1.close();
    channel.port2.close();
  });
  dom.window.close();
});

test("没有现存配置仍能查看已删除任务历史，名称查询和翻页保持范围并重置页码", async () => {
  seedLogs();
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole("button", { name: "执行记录", exact: true }),
  );
  const dialog = within(await screen.findByRole("dialog"));
  await dialog.findByText("检查完成 0");
  assert.equal(dialog.getAllByText("已删除的日常维护").length, 5);
  assert.equal(logQueries().at(-1).query.has("jobId"), false);
  await user.click(dialog.getByTitle("2"));
  await dialog.findByText("检查完成 5");
  assert.equal(logQueries().at(-1).query.get("page"), "2");
  await user.type(
    dialog.getByRole("searchbox", { name: "搜索执行记录任务名称" }),
    "不存在{Enter}",
  );
  await dialog.findAllByText(/暂无数据|No data/);
  assert.equal(logQueries().at(-1).query.get("keyword"), "不存在");
  assert.equal(logQueries().at(-1).query.get("page"), "1");
  await user.clear(
    dialog.getByRole("searchbox", { name: "搜索执行记录任务名称" }),
  );
  await dialog.findByText("检查完成 0");
  assert.equal(logQueries().at(-1).query.get("keyword"), "");
  assert.equal(
    dialog.queryByRole("button", { name: /^恢\s*复$/, exact: true }),
    null,
  );
});

test("保留配置行级历史，关闭再打开页级入口不会沿用旧配置筛选", async () => {
  seedLogs(1);
  configurations = [
    {
      id: 41,
      name: "当前配置",
      handler: "DATABASE_CHECK",
      cron: "0 */5 * * * *",
      enabled: false,
      version: 2,
    },
  ];
  logs.push({
    ...logs[0],
    id: 1041,
    jobId: 41,
    jobName: "当前配置",
    result: "本配置执行完成",
  });
  const user = userEvent.setup();
  mount();
  const name = await screen.findByText("当前配置");
  const row = within(name.closest("tr"));
  await user.click(
    row.getByRole("button", { name: "执行记录：41", exact: true }),
  );
  let dialog = within(await screen.findByRole("dialog"));
  await dialog.findByText("本配置执行完成");
  assert.equal(logQueries().at(-1).query.get("jobId"), "41");
  assert.equal(dialog.queryByText("已删除的日常维护"), null);
  await user.click(
    dialog.getByRole("button", { name: /^关\s*闭$/, exact: true }),
  );
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await user.click(
    screen.getAllByRole("button", { name: "执行记录", exact: true })[0],
  );
  dialog = within(await screen.findByRole("dialog"));
  await dialog.findByText("已删除的日常维护");
  assert.equal(logQueries().at(-1).query.has("jobId"), false);
});

test("加载失败可重试且响应缺字段报错，取消冲突不伪造成功，恢复使用原执行编号与最新版本", async () => {
  seedLogs(1);
  logs[0].status = "RUNNING";
  canExecute = rejectLogs = true;
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole("button", { name: "执行记录", exact: true }),
  );
  const dialog = within(await screen.findByRole("dialog"));
  await dialog.findByText("记录服务暂时不可用");
  rejectLogs = false;
  await user.click(
    dialog.getByRole("button", { name: /^重\s*试$/, exact: true }),
  );
  await dialog.findByText("检查完成 0");
  rejectControl = true;
  await user.click(
    dialog.getByRole("button", { name: /^取\s*消$/, exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "OK", exact: true }),
  );
  await screen.findByText("执行状态已变化，请刷新后再操作");
  assert.equal(logs[0].status, "RUNNING");
  assert.equal(logs[0].version, 7);
  rejectControl = false;
  await user.click(
    dialog.getByRole("button", { name: /^取\s*消$/, exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "OK", exact: true }),
  );
  await dialog.findByRole("button", { name: /^恢\s*复$/, exact: true });
  assert.equal(logs[0].version, 8);
  await user.click(
    dialog.getByRole("button", { name: /^恢\s*复$/, exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "OK", exact: true }),
  );
  await waitFor(() => assert.equal(logs[0].status, "QUEUED"));
  assert.equal(logs[0].version, 9);
  assert(
    calls.some(
      (call) =>
        call.path === "/api/operations/job-logs/1000/retry" &&
        call.method === "POST",
    ),
  );
  incompleteLogs = true;
  await assert.rejects(jobExecutions(undefined, 1), /执行记录响应不完整/);
});

test("手机历史沿用共用卡片和每页五条，已删除任务信息与分页仍可操作", async () => {
  tableWidth = 420;
  seedLogs();
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole("button", { name: "执行记录", exact: true }),
  );
  const dialog = within(await screen.findByRole("dialog"));
  await dialog.findByText("检查完成 0");
  const list = within(dialog.getByRole("list", { name: "任务执行记录" }));
  assert.equal(list.getAllByRole("listitem").length, 5);
  assert.ok(list.getByText("序号 1"));
  await user.click(dialog.getByTitle("2"));
  await dialog.findByText("检查完成 5");
  assert.ok(
    within(dialog.getByRole("list", { name: "任务执行记录" })).getByText(
      "序号 6",
    ),
  );
  assert.equal(logQueries().at(-1).query.get("size"), "5");
});
