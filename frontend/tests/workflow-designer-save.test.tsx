import { JSDOM } from "jsdom";
import * as nodeModule from "node:module";
import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowDefinition, WorkflowSpec } from "../src/types/workflow";

/**
 * 整页验收设计、保存与发布的用户边界：真实上下文通过合成 HTTP 响应建立测试身份。
 * 本测试不会访问真实数据库或浏览器会话；CSS 只在 Node 中忽略，视觉布局另由浏览器验收。
 */
// registerHooks 自 22.15 起可用；README 支持的 22.12 使用异步 register，规则仍仅跳过 CSS。
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
const clientWidth = Object.getOwnPropertyDescriptor(
  dom.window.Element.prototype,
  "clientWidth",
)!.get!;
Object.defineProperty(dom.window.Element.prototype, "clientWidth", {
  configurable: true,
  get() {
    return this.classList.contains("workflow-form-builder")
      ? 1300
      : clientWidth.call(this);
  },
});
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
const { render, screen, waitFor, within, fireEvent, cleanup, act } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { ConfigProvider, App } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { createMemoryRouter, RouterProvider } = await import("react-router-dom");
const { AuthProvider, useAuth } = await import("../src/lib/auth");
const { ModulesProvider } = await import("../src/lib/modules");
const { WorkspaceProvider } = await import("../src/lib/workspace");
const { WorkflowDesignerPage } =
  await import("../src/pages/operations/WorkflowDesignerPage");
const { initialSpec } = await import("../src/types/workflow");
const clients: InstanceType<typeof QueryClient>[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const requests: {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}[] = [];
let permissions: string[] = [];
let serverRecord: WorkflowDefinition;
let deferSave = false;
let completeSave: (() => void) | null = null;
const originalFetch = globalThis.fetch;

function response(data: unknown) {
  return Response.json({ success: true, data });
}
/** 所有记录都属于当前测试内存；持久化与乐观版本仅模拟 HTTP 契约，不替代 Java 校验。 */
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
  requests.push({ path: url.pathname, method, body });
  if (url.pathname === "/api/auth/me")
    return response({
      user: { id: 101, nickname: "合成设计账号" },
      permissions,
      dataScopes: {},
      admin: false,
    });
  if (url.pathname === "/api/platform/features")
    return response({
      modules: {
        approvals: true,
        content: false,
        portal: false,
        notifications: true,
      },
    });
  if (url.pathname === "/api/operations/workflows/21" && method === "GET")
    return response(structuredClone(serverRecord));
  if (url.pathname === "/api/operations/workflows/21" && method === "PUT") {
    const saved = {
      ...serverRecord,
      schema: structuredClone(body!.schema as WorkflowSpec),
      version: serverRecord.version + 1,
    };
    if (deferSave)
      return new Promise<Response>((resolve) => {
        completeSave = () => {
          serverRecord = saved;
          resolve(response(saved));
          completeSave = null;
        };
      });
    serverRecord = saved;
    return response(saved);
  }
  if (
    url.pathname === "/api/operations/workflows/21/publish" &&
    method === "POST"
  ) {
    serverRecord = {
      ...serverRecord,
      publishedVersionId: 81,
      publishedVersion: 1,
    };
    return response(serverRecord);
  }
  if (
    url.pathname === "/api/operations/workflows/simulate" &&
    method === "POST"
  )
    return response({
      valid: true,
      path: [
        {
          id: "review",
          name: "主管审批",
          type: "APPROVAL",
          approvers: [{ id: 102, name: "合成主管" }],
        },
      ],
    });
  return Response.json(
    { success: false, message: "测试没有定义此接口" },
    { status: 404 },
  );
};
beforeEach(() => {
  requests.length = 0;
  sessionStorage.clear();
  permissions = ["workflows:view", "workflows:update", "workflows:publish"];
  deferSave = false;
  completeSave = null;
  const schema = initialSpec();
  schema.fields = [
    {
      id: "memo",
      label: "申请说明",
      type: "TEXT",
      required: true,
      maxLength: 100,
      width: 24,
    },
  ];
  schema.nodes[0].assigneeIds = [102];
  schema.nodes[0].readable = ["memo"];
  serverRecord = {
    id: 21,
    version: 1,
    name: "合成设计测试",
    code: "synthetic_designer",
    description: "只在测试内存中使用",
    enabled: true,
    categoryId: 1,
    category: "通用申请",
    businessType: "GENERAL",
    schema,
    publishedVersionId: null,
    publishedVersion: null,
    personOptions: [{ value: 102, label: "合成主管" }],
    createdAt: "2026-10-03T00:00:00",
    updatedAt: "2026-10-03T00:00:00",
  };
});
afterEach(async () => {
  if (completeSave) await act(async () => completeSave!());
  cleanup();
  routers.splice(0).forEach((router) => router.dispose());
  clients.splice(0).forEach((client) => client.clear());
});
after(() => {
  globalThis.fetch = originalFetch;
  styles?.deregister();
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

/** Gate 等真实 AuthProvider 获取合成会话后再挂载工作区，避免假造内部权限上下文。 */
function Gate() {
  const { session } = useAuth();
  return session ? (
    <WorkspaceProvider>
      <WorkflowDesignerPage />
    </WorkspaceProvider>
  ) : null;
}
async function mountPage() {
  // 仅 JSDOM 内存存储中的固定测试令牌，无任何真实浏览器令牌注入。
  sessionStorage.setItem("mayday.session", "synthetic-test-session");
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
    { initialEntries: ["/admin/workflow-designer?id=21"] },
  );
  routers.push(router);
  render(<RouterProvider router={router} />);
  await screen.findByText("合成设计测试", {
    selector: ".designer-toolbar strong",
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "表单设计 (1)" }));
  await screen.findByLabelText("字段标题");
  return user;
}
function writes(method: string, path = "/api/operations/workflows/21") {
  return requests.filter(
    (request) => request.method === method && request.path === path,
  );
}

test("保存请求未完成时禁止编辑、重复保存和预览入口，响应不覆盖遗漏的新修改", async () => {
  deferSave = true;
  const user = await mountPage();
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "待保存标题" },
  });
  const save = screen.getByRole("button", { name: "保存草稿", exact: true });
  await user.click(save);
  await waitFor(() => assert.equal(writes("PUT").length, 1));
  assert.equal(
    (screen.getByLabelText("字段标题") as HTMLInputElement).disabled,
    true,
  );
  assert.equal(
    (screen.getByRole("button", { name: "添加金额" }) as HTMLButtonElement)
      .disabled,
    true,
  );
  assert.equal(
    (screen.getByRole("button", { name: "预览与模拟" }) as HTMLButtonElement)
      .disabled,
    true,
  );
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "保存中伪造修改" },
  });
  fireEvent.click(save);
  fireEvent.click(screen.getByRole("button", { name: "添加金额" }));
  assert.equal(writes("PUT").length, 1);
  assert.equal(
    (writes("PUT")[0].body!.schema as WorkflowSpec).fields[0].label,
    "待保存标题",
  );
  await act(async () => completeSave!());
  await screen.findByText("流程草稿已保存");
  assert.equal(
    (screen.getByLabelText("字段标题") as HTMLInputElement).value,
    "待保存标题",
  );
  assert.equal(screen.getByRole("tab", { name: "表单设计 (1)" }) != null, true);
  assert.equal(
    screen.queryByText("未保存", { selector: ".dirty-label" }),
    null,
  );
});

test("只有发布权限的账号可确认发布干净草稿，不获得编辑或 PUT 保存权限", async () => {
  permissions = ["workflows:view", "workflows:publish"];
  const user = await mountPage();
  assert.equal(
    (screen.getByLabelText("字段标题") as HTMLInputElement).disabled,
    true,
  );
  assert.equal(
    screen.queryByRole("button", { name: "保存草稿", exact: true }),
    null,
  );
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "无权限改名" },
  });
  await user.click(
    screen.getByRole("button", { name: "发布版本", exact: true }),
  );
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^发\s*布$/ }));
  await screen.findByText("新版本已发布");
  assert.equal(writes("PUT").length, 0);
  const publishes = writes("POST", "/api/operations/workflows/21/publish");
  assert.equal(publishes.length, 1);
  assert.deepEqual(publishes[0].body, { version: 1 });
  assert.equal(serverRecord.schema.fields[0].label, "申请说明");
  assert.ok(screen.getByText("已发布版本 1"));
});

test("同字段保存后继续编辑，一次撤销返回已保存值并恢复干净状态", async () => {
  const user = await mountPage();
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "保存后的标题" },
  });
  await user.click(
    screen.getByRole("button", { name: "保存草稿", exact: true }),
  );
  await screen.findByText("流程草稿已保存");
  await waitFor(() =>
    assert.equal(
      (screen.getByLabelText("字段标题") as HTMLInputElement).disabled,
      false,
    ),
  );
  assert.equal(serverRecord.schema.fields[0].label, "保存后的标题");
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "保存后追加修改" },
  });
  assert.ok(screen.getByText("未保存", { selector: ".dirty-label" }));
  await user.click(
    screen.getByRole("button", { name: "撤销表单修改", exact: true }),
  );
  assert.equal(
    (screen.getByLabelText("字段标题") as HTMLInputElement).value,
    "保存后的标题",
  );
  assert.equal(
    screen.queryByText("未保存", { selector: ".dirty-label" }),
    null,
  );
  assert.equal(
    (
      screen.getByRole("button", {
        name: "保存草稿",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  assert.equal(writes("PUT").length, 1);
});

test("切到其他设计标签后返回，连续编辑同一字段作为新的撤销步骤", async () => {
  const user = await mountPage();
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "切换标签前的标题" },
  });
  await user.click(screen.getByRole("tab", { name: "其他设置" }));
  await user.click(screen.getByRole("tab", { name: "表单设计 (1)" }));
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "切换标签后的标题" },
  });
  await user.click(
    screen.getByRole("button", { name: "撤销表单修改", exact: true }),
  );
  assert.equal(
    (screen.getByLabelText("字段标题") as HTMLInputElement).value,
    "切换标签前的标题",
  );
  assert.ok(screen.getByText("未保存", { selector: ".dirty-label" }));
  assert.equal(writes("PUT").length, 0);
});

test("编辑删除了条件使用的单选选项时，保存定位表单并阻止发送无效草稿", async () => {
  serverRecord.schema.fields = [
    {
      id: "kind",
      label: "费用类别",
      type: "SINGLE",
      options: ["差旅", "采购"],
      width: 24,
    },
  ];
  serverRecord.schema.nodes[0].readable = ["kind"];
  serverRecord.schema.nodes.unshift({
    id: "category_rule",
    name: "费用类别分流",
    type: "CONDITION",
    next: "review",
    conditions: [
      { field: "kind", operator: "EQ", value: "采购", next: "review" },
    ],
  });
  serverRecord.schema.startNodeId = "category_rule";
  const user = await mountPage();
  await user.click(
    screen.getByRole("button", { name: "删除选项 2", exact: true }),
  );
  await user.click(screen.getByRole("tab", { name: "其他设置" }));
  await user.click(
    screen.getByRole("button", { name: "保存草稿", exact: true }),
  );
  assert.ok(
    await screen.findByText(
      "条件节点“费用类别分流”使用的字段“费用类别”选项已不存在，请重新配置分支条件",
      { selector: ".workflow-form-field-error" },
    ),
  );
  assert.equal(
    screen
      .getByRole("tab", { name: "表单设计 (1)" })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(writes("PUT").length, 0);
  assert.equal(
    writes("POST", "/api/operations/workflows/21/publish").length,
    0,
  );
  assert.deepEqual(serverRecord.schema.fields[0].options, ["差旅", "采购"]);
});
