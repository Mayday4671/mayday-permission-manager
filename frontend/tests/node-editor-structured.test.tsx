import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowField, WorkflowNode } from "../src/types/workflow";

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
const { useState } = React;
const { render, screen, within, waitFor, cleanup } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { AuthProvider } = await import("../src/lib/auth");
const { NodeEditor } = await import("../src/components/workflow/NodeEditor");
const clients = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  Response.json({
    success: true,
    data: { items: [], page: 1, size: 30, total: 0 },
  });

const fields: WorkflowField[] = [
  { id: "memo", label: "申请说明", type: "TEXT" },
  { id: "amount", label: "申请金额", type: "MONEY" },
  { id: "kind", label: "申请类型", type: "SINGLE", options: ["差旅", "采购"] },
];

/** Provider 使用真实组件上下文；无会话令牌，也不请求真实网络或写入业务数据。 */
function mountNode(
  node: WorkflowNode,
  onSave: (value: WorkflowNode) => void,
  branchIndex: number | null = null,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  function Harness() {
    const [editing, setEditing] = useState<WorkflowNode | null>(node);
    return (
      <NodeEditor
        node={editing}
        existing
        structured
        branchIndex={branchIndex}
        nodes={[node, { id: "end", name: "结束", type: "END" }]}
        fields={fields}
        onClose={() => setEditing(null)}
        onSave={(value) => {
          onSave(value);
          setEditing(null);
        }}
      />
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <AuthProvider>
            <Harness />
          </AuthProvider>
        </App>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  localStorage.clear();
  sessionStorage.clear();
});
after(() => {
  globalThis.fetch = originalFetch;
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

test("OA 审批设置只编辑业务属性，保存名称及字段权限后保留节点标识、类型和连线", async () => {
  const user = userEvent.setup();
  let saved: WorkflowNode | undefined;
  const node: WorkflowNode = {
    id: "review_auto_37",
    name: "部门审批",
    type: "APPROVAL",
    source: "DEPARTMENT_LEADER",
    mode: "ALL",
    next: "end",
    readable: ["memo"],
    writable: [],
    actions: ["APPROVE", "REJECT", "RETURN"],
    timeoutMinutes: 1440,
    conditions: [],
  };
  mountNode(node, (value) => {
    saved = value;
  });
  const dialog = await screen.findByRole("dialog", { name: "审批人设置" });
  assert.equal(within(dialog).queryByLabelText("节点 ID"), null);
  assert.equal(within(dialog).queryByLabelText("节点类型"), null);
  assert.equal(within(dialog).queryByLabelText("下一节点"), null);
  const name = within(dialog).getByLabelText("节点名称");
  await user.clear(name);
  await user.type(name, "直属负责人审批");
  await user.click(within(dialog).getByRole("tab", { name: "字段权限" }));
  const group = within(dialog).getByRole("radiogroup", {
    name: "申请说明权限",
  });
  await user.click(within(group).getByText("可编辑", { exact: true }));
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert(saved));
  assert.equal(saved.id, node.id);
  assert.equal(saved.type, node.type);
  assert.equal(saved.next, node.next);
  assert.equal(saved.name, "直属负责人审批");
  assert.deepEqual(saved.actions, node.actions);
  assert.equal(saved.timeoutMinutes, 1440);
  assert.deepEqual(saved.readable, ["memo"]);
  assert.deepEqual(saved.writable, ["memo"]);
});

test("指定分支只校验当前规则，隐藏的出口及其他尚未配置的分支不因保存被删除", async () => {
  const user = userEvent.setup();
  let saved: WorkflowNode | undefined;
  const node: WorkflowNode = {
    id: "condition_auto_42",
    name: "金额判断",
    type: "CONDITION",
    next: "end",
    conditions: [
      { field: "", operator: "EQ", value: "", next: "review_a" },
      { field: "amount", operator: "GE", value: "100.25", next: "review_b" },
    ],
  };
  mountNode(
    node,
    (value) => {
      saved = value;
    },
    1,
  );
  const dialog = await screen.findByRole("dialog", { name: "条件2设置" });
  assert.equal(within(dialog).queryByLabelText("节点名称"), null);
  assert.equal(within(dialog).queryByLabelText("满足时前往"), null);
  assert.equal(within(dialog).queryByLabelText("默认出口"), null);
  assert.equal(
    within(dialog).queryByRole("button", { name: "添加规则" }),
    null,
  );
  assert.equal(
    within(dialog).queryByRole("button", { name: "移除规则" }),
    null,
  );
  const value = within(dialog).getByRole("spinbutton");
  assert.equal(value.value, "100.25");
  await user.clear(value);
  await user.type(value, "250.50");
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert(saved));
  assert.equal(saved.id, node.id);
  assert.equal(saved.type, node.type);
  assert.equal(saved.name, node.name);
  assert.equal(saved.next, node.next);
  assert.equal(saved.conditions.length, 2);
  assert.deepEqual(saved.conditions[0], node.conditions[0]);
  assert.equal(saved.conditions[1].next, "review_b");
  assert.equal(saved.conditions[1].field, "amount");
  assert.equal(saved.conditions[1].operator, "GE");
  assert.equal(typeof saved.conditions[1].value, "string");
  assert.equal(Number(saved.conditions[1].value), 250.5);
});

test("文字字段不提供数值大小比较，单选比较值直接使用表单已有选项", async () => {
  const user = userEvent.setup();
  let saved: WorkflowNode | undefined;
  const node: WorkflowNode = {
    id: "condition_auto_51",
    name: "类型判断",
    type: "CONDITION",
    next: "end",
    conditions: [
      { field: "memo", operator: "EQ", value: "出差", next: "review_a" },
    ],
  };
  mountNode(
    node,
    (value) => {
      saved = value;
    },
    0,
  );
  const dialog = await screen.findByRole("dialog", { name: "条件1设置" });
  await user.click(within(dialog).getByLabelText("比较方式"));
  // Ant 虚拟列表仅把当前邻近项放到辅助 listbox；用可见选项标题检查完整菜单。
  await screen.findByTitle("包含");
  for (const name of ["大于", "大于等于", "小于", "小于等于"])
    assert.equal(screen.queryByTitle(name), null);
  await user.keyboard("{Escape}");
  await user.click(within(dialog).getByLabelText("表单字段"));
  await user.click(await screen.findByTitle("申请类型"));
  const value = within(dialog).getByLabelText("比较值");
  assert.equal(value.getAttribute("role"), "combobox");
  await user.click(value);
  await user.click(await screen.findByTitle("采购"));
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert(saved));
  assert.deepEqual(saved.conditions[0], {
    field: "kind",
    operator: "EQ",
    value: "采购",
    next: "review_a",
  });
});
