import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { ApprovalDetail } from "../src/types/workflow";

// 真实 Ant 表单的组件回归；只使用合成流程，不代替浏览器外观或真实后端验收。
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
  "HTMLTextAreaElement",
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
const { render, screen, within, waitFor, cleanup } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { AuthProvider } = await import("../src/lib/auth");
const { WorkflowHandoverModal } =
  await import("../src/components/WorkflowHandoverModal");
const { WorkflowDelegationModal } =
  await import("../src/components/WorkflowDelegationModal");
const clients: InstanceType<typeof QueryClient>[] = [];
const originalFetch = globalThis.fetch;
const calls: {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}[] = [];
let rejectHandover = false;
let grants = [
  "requests:delegate",
  "requests:approve",
  "requests:view",
  "users:view",
];
globalThis.fetch = async (input, options) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    "http://localhost",
  );
  const method =
    options?.method ?? (input instanceof Request ? input.method : "GET");
  const bodyText =
    typeof options?.body === "string"
      ? options.body
      : input instanceof Request && method !== "GET"
        ? await input.clone().text()
        : "";
  const body = bodyText ? JSON.parse(bodyText) : undefined;
  calls.push({ path: url.pathname + url.search, method, body });
  let data: unknown;
  if (url.pathname === "/api/auth/me")
    data = {
      user: { id: 101, nickname: "测试审批人" },
      permissions: grants,
      dataScopes: {},
      scopeDepartments: {},
    };
  else if (url.pathname === "/api/system/options/users")
    data = {
      items: [{ value: 202, label: "接收审批人" }],
      total: 1,
      page: 1,
      size: 30,
    };
  else if (url.pathname === "/api/operations/delegations/scopes")
    data = [{ value: 7, label: "采购流程" }];
  else if (url.pathname === "/api/operations/delegations")
    data =
      method === "POST" ? { id: 4 } : { items: [], total: 0, page: 1, size: 6 };
  else if (url.pathname.endsWith("/handover")) {
    if (rejectHandover)
      return Response.json(
        { success: false, message: "数据已被其他人修改，请刷新后重试" },
        { status: 409 },
      );
    data = { id: 8 };
  } else throw new Error("未登记的组件测试请求：" + url.pathname);
  return Response.json({ success: true, data });
};
function mount(children: React.ReactNode) {
  sessionStorage.setItem("mayday.session", "synthetic-session");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <AuthProvider>{children}</AuthProvider>
        </App>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  sessionStorage.clear();
  localStorage.clear();
  calls.length = 0;
  rejectHandover = false;
  grants = [
    "requests:delegate",
    "requests:approve",
    "requests:view",
    "users:view",
  ];
});
after(() => {
  globalThis.fetch = originalFetch;
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});
test("管理员交接弹窗选择停用原人、有效新人，携带打开版本与理由提交", async () => {
  const user = userEvent.setup();
  let completed = 0;
  const record = {
    id: 8,
    version: 3,
    handoverSources: [{ value: 11, label: "原审批人（已停用）" }],
  } as ApprovalDetail;
  mount(
    <WorkflowHandoverModal
      record={record}
      onClose={() => {}}
      onSuccess={async () => {
        completed++;
      }}
    />,
  );
  const dialog = await screen.findByRole("dialog", { name: "人员交接" });
  await user.click(within(dialog).getByLabelText("原审批人"));
  await user.click(await screen.findByText("原审批人（已停用）"));
  await user.click(within(dialog).getByLabelText("新审批人"));
  await user.click(await screen.findByText("接收审批人"));
  await user.type(within(dialog).getByLabelText("交接原因"), "离职移交");
  await user.click(within(dialog).getByRole("button", { name: "确认交接" }));
  await waitFor(() => assert.equal(completed, 1));
  const request = calls.find((c) => c.path.endsWith("/handover"));
  assert.equal(request?.method, "POST");
  assert.deepEqual(request?.body, {
    version: 3,
    fromUserId: 11,
    targetUserId: 202,
    reason: "离职移交",
  });
});
test("交接请求版本冲突保留输入，不能误报成功", async () => {
  rejectHandover = true;
  const user = userEvent.setup();
  let closed = false;
  mount(
    <WorkflowHandoverModal
      record={
        {
          id: 8,
          version: 3,
          handoverSources: [{ value: 11, label: "待交接人员" }],
        } as ApprovalDetail
      }
      onClose={() => {
        closed = true;
      }}
      onSuccess={async () => assert.fail("冲突不能触发成功")}
    />,
  );
  const dialog = await screen.findByRole("dialog", { name: "人员交接" });
  await user.click(within(dialog).getByLabelText("原审批人"));
  await user.click(await screen.findByText("待交接人员"));
  await user.click(within(dialog).getByLabelText("新审批人"));
  await user.click(await screen.findByText("接收审批人"));
  await user.type(within(dialog).getByLabelText("交接原因"), "交接说明");
  await user.click(within(dialog).getByRole("button", { name: "确认交接" }));
  await screen.findByText("数据已被其他人修改，请刷新后重试");
  assert.equal(closed, false);
  assert.equal(
    (within(dialog).getByLabelText("交接原因") as HTMLTextAreaElement).value,
    "交接说明",
  );
});
test("委托列表区分本人和收到的记录，默认六条，新增安排不提交他人身份", async () => {
  const user = userEvent.setup();
  mount(<WorkflowDelegationModal open onClose={() => {}} />);
  const dialog = await screen.findByRole("dialog", { name: "审批委托" });
  await user.click(
    await within(dialog).findByRole("button", { name: "新增委托" }),
  );
  const create = await screen.findByRole("dialog", { name: "新增审批委托" });
  await user.click(within(create).getByLabelText("受托人"));
  await user.click(await screen.findByText("接收审批人"));
  await user.type(within(create).getByLabelText("委托原因"), "外出请假");
  await user.click(within(create).getByRole("button", { name: /保\s*存/ }));
  await waitFor(() =>
    assert(
      calls.some(
        (c) => c.path === "/api/operations/delegations" && c.method === "POST",
      ),
    ),
  );
  const body = calls.find(
    (c) => c.path === "/api/operations/delegations" && c.method === "POST",
  )?.body;
  assert.equal(body?.targetId, 202);
  assert.equal(body?.reason, "外出请假");
  assert.deepEqual(body?.definitionIds, []);
  assert(!Object.hasOwn(body ?? {}, "ownerId"));
  assert.match(String(body?.startsAt), /^\d{4}-\d{2}-\d{2}T/);
  await user.click(within(dialog).getByText("我收到的"));
  await waitFor(() =>
    assert(
      calls.some(
        (c) => c.path.includes("box=received") && c.path.includes("size=6"),
      ),
    ),
  );
});
