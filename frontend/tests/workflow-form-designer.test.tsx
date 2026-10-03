import { JSDOM } from "jsdom";
import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowField, WorkflowSpec } from "../src/types/workflow";

/**
 * 使用真实 React、Ant 属性面板和原生拖放事件验收表单编排。
 * 所有模型都是合成数据；本测试不接触数据库、不上传文件，也不代替浏览器尺寸与外观验收。
 */
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
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.innerWidth = 1366;
globalThis.innerHeight = 900;
globalThis.scrollX = 0;
globalThis.scrollY = 0;
let workspaceWidth = 1200;
const originalClientWidth = Object.getOwnPropertyDescriptor(
  dom.window.Element.prototype,
  "clientWidth",
)!.get!;
Object.defineProperty(dom.window.Element.prototype, "clientWidth", {
  configurable: true,
  get() {
    return this.classList.contains("workflow-form-builder")
      ? workspaceWidth
      : originalClientWidth.call(this);
  },
});
/** 模拟浏览器容器尺寸变化，而不是只改 innerWidth；生产组件监听的正是 ResizeObserver。 */
const resizeObservers = new Set<{
  callback: (entries: unknown[]) => void;
  elements: Set<Element>;
}>();
globalThis.ResizeObserver = class {
  callback: (entries: unknown[]) => void;
  elements = new Set<Element>();
  constructor(callback: (entries: unknown[]) => void) {
    this.callback = callback;
    resizeObservers.add(this);
  }
  observe(element: Element) {
    this.elements.add(element);
  }
  unobserve(element: Element) {
    this.elements.delete(element);
  }
  disconnect() {
    resizeObservers.delete(this);
  }
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

// 先初始化 DOM，再加载 Ant 和 Testing Library，确保弹窗 Portal 使用同一个 document。
const React = await import("react");
const { useState } = React;
const { render, screen, cleanup, within, waitFor, fireEvent, act } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { WorkflowFormDesigner } =
  await import("../src/components/workflow/WorkflowFormDesigner");
const { initialSpec } = await import("../src/types/workflow");
const clients: InstanceType<typeof QueryClient>[] = [];
const requests: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  requests.push(String(input));
  return Response.json({
    success: true,
    data: { items: [], page: 1, size: 30, total: 0 },
  });
};
beforeEach(() => {
  workspaceWidth = 1200;
  dom.window.innerHeight = 900;
  dom.window.scrollY = 0;
  requests.length = 0;
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});
after(() => {
  globalThis.fetch = originalFetch;
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

/** 状态由父层回写，避免测试一直向组件传入陈旧模型而漏掉连续操作错误。 */
function mountDesigner(spec: WorkflowSpec, editable = true, pageShell = false) {
  let latest = spec;
  const changes: { spec: WorkflowSpec; historyKey?: string }[] = [];
  let undoCount = 0;
  let redoCount = 0;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  function Harness() {
    const [value, setValue] = useState(spec);
    return (
      <QueryClientProvider client={client}>
        <ConfigProvider theme={{ token: { motion: false } }}>
          <App>
            <div className={pageShell ? "workflow-designer" : undefined}>
              <WorkflowFormDesigner
                spec={value}
                editable={editable}
                formName="合成费用申请"
                onChange={(next, historyKey) => {
                  latest = next;
                  changes.push({ spec: next, historyKey });
                  setValue(next);
                }}
                canUndo
                canRedo
                onUndo={() => undoCount++}
                onRedo={() => redoCount++}
              />
            </div>
          </App>
        </ConfigProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<Harness />);
  return {
    ...view,
    changes,
    get latest() {
      return latest;
    },
    get undoCount() {
      return undoCount;
    },
    get redoCount() {
      return redoCount;
    },
  };
}

function sampleSpec(fields?: WorkflowField[]): WorkflowSpec {
  const spec = initialSpec();
  spec.fields = fields ?? [
    { id: "reason", label: "申请事由", type: "TEXT", width: 24 },
    { id: "amount", label: "申请金额", type: "MONEY", width: 12 },
    { id: "date", label: "发生日期", type: "DATE", width: 12 },
    { id: "remarks", label: "补充说明", type: "TEXTAREA", width: 24 },
  ];
  spec.nodes[0].readable = spec.fields.map((field) => field.id);
  spec.nodes[0].writable = [spec.fields[0]?.id].filter(Boolean);
  return spec;
}

/** 浏览器传入的 DataTransfer 足够完整，仍只通过组件真实 dragStart 保存内部拖放来源。 */
function transfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "all",
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
  };
}
function fieldIds(spec: WorkflowSpec) {
  return spec.fields.map((field) => field.id);
}
function fieldCard(id: string) {
  const field = document.querySelector<HTMLElement>(`[data-field-id="${id}"]`);
  assert.ok(field, `画布应包含字段 ${id}`);
  return field;
}
async function resizeWorkspace(width: number) {
  workspaceWidth = width;
  await act(async () => {
    resizeObservers.forEach(({ callback }) => callback([]));
  });
}

test("页头换行、窗口高度和滚动位置变化后画布仍保留页脚空间，隐藏面板不改高度", async () => {
  const designer = mountDesigner(sampleSpec(), true, true);
  const builder = document.querySelector<HTMLElement>(
    ".workflow-form-builder",
  )!;
  const shell = builder.closest(".workflow-designer")!;
  let top = 301;
  builder.getBoundingClientRect = () => ({
    x: 0,
    y: top,
    top,
    left: 0,
    right: workspaceWidth,
    bottom: top + 471,
    width: workspaceWidth,
    height: 471,
    toJSON() {
      return {};
    },
  });
  assert.ok(
    [...resizeObservers].some(
      ({ elements }) => elements.has(builder) && elements.has(shell),
    ),
    "页头换行改变最近设计容器尺寸时，也应触发画布测量",
  );
  dom.window.innerHeight = 844;
  await resizeWorkspace(390);
  assert.equal(builder.style.height, "471px");
  // 页头换行压缩可用空间；观察器不能继续沿用桌面固定减数。
  top = 342.4;
  await resizeWorkspace(390);
  assert.equal(builder.style.height, "429px");
  dom.window.innerHeight = 680;
  fireEvent(window, new Event("resize"));
  assert.equal(builder.style.height, "265px");
  // 切走设计标签后宽度为零，隐藏容器的零尺寸不得覆盖上次可操作高度。
  dom.window.innerHeight = 480;
  top = 360;
  await resizeWorkspace(0);
  assert.equal(builder.style.height, "265px");
  await resizeWorkspace(390);
  assert.equal(builder.style.height, "240px");
  dom.window.innerHeight = 844;
  dom.window.scrollY = 64;
  top = 301;
  fireEvent(window, new Event("resize"));
  assert.equal(builder.style.height, "407px");
  assert.equal(designer.changes.length, 0);
});

test("桌面点击控件直接插入并选中右侧属性，不弹出添加字段对话框", async () => {
  const source = sampleSpec([]);
  const original = structuredClone(source);
  const designer = mountDesigner(source);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "添加单行文字", exact: true }),
  );
  assert.equal(designer.changes.length, 1);
  const field = designer.latest.fields[0];
  assert.equal(field.type, "TEXT");
  assert.equal(fieldCard(field.id).getAttribute("aria-pressed"), "true");
  assert.equal(
    (screen.getByLabelText("字段标题") as HTMLInputElement).value,
    "单行文字",
  );
  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(screen.getByRole("complementary", { name: "表单控件库" }));
  assert.ok(screen.getByRole("complementary", { name: "字段属性" }));
  assert.deepEqual(source, original, "控件插入不能改写父层原始快照");
});

test("选中字段即时编辑业务标题，稳定 ID、类型与流程读写引用保持不变", async () => {
  const source = sampleSpec();
  const original = structuredClone(source);
  const designer = mountDesigner(source);
  const user = userEvent.setup();
  await user.click(fieldCard("amount"));
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "费用金额" },
  });
  const updated = designer.latest.fields.find(
    (field) => field.id === "amount",
  )!;
  assert.equal(updated.label, "费用金额");
  assert.equal(updated.id, "amount");
  assert.equal(updated.type, "MONEY");
  assert.deepEqual(designer.latest.nodes, original.nodes);
  assert.equal(designer.changes.at(-1)!.historyKey, "field:amount");
  assert.equal(screen.queryByLabelText("字段 ID"), null);
  assert.equal(screen.queryByLabelText("字段类型"), null);
  assert.deepEqual(source, original);
});

test("复制明细表生成相邻新 ID，列和选项深拷贝且不继承原字段节点授权", async () => {
  const source = sampleSpec([
    {
      id: "items",
      label: "报销明细",
      type: "DETAILS",
      maxRows: 10,
      columns: [
        {
          id: "kind",
          label: "费用类别",
          type: "SINGLE",
          options: ["交通", "住宿"],
        },
        { id: "fee", label: "费用", type: "MONEY" },
      ],
    },
  ]);
  const designer = mountDesigner(source);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "复制报销明细", exact: true }),
  );
  const [original, copied] = designer.latest.fields;
  assert.notEqual(copied.id, original.id);
  assert.equal(copied.label, "报销明细（副本）");
  assert.deepEqual(copied.columns, original.columns);
  assert.notEqual(copied.columns, original.columns);
  assert.notEqual(copied.columns![0].options, original.columns![0].options);
  assert.deepEqual(designer.latest.nodes[0].readable, ["items"]);
  assert.deepEqual(designer.latest.nodes[0].writable, ["items"]);
  assert.equal(fieldCard(copied.id).getAttribute("aria-pressed"), "true");
});

test("上下移动和 Alt 快捷键仅调整相邻顺序，首尾按钮不可越界", async () => {
  const designer = mountDesigner(sampleSpec());
  const user = userEvent.setup();
  assert.equal(
    (screen.getByRole("button", { name: "上移申请事由" }) as HTMLButtonElement)
      .disabled,
    true,
  );
  assert.equal(
    (screen.getByRole("button", { name: "下移补充说明" }) as HTMLButtonElement)
      .disabled,
    true,
  );
  await user.click(screen.getByRole("button", { name: "下移申请金额" }));
  assert.deepEqual(fieldIds(designer.latest), [
    "reason",
    "date",
    "amount",
    "remarks",
  ]);
  await user.click(screen.getByRole("button", { name: "上移申请金额" }));
  assert.deepEqual(fieldIds(designer.latest), [
    "reason",
    "amount",
    "date",
    "remarks",
  ]);
  fireEvent.keyDown(fieldCard("amount"), { altKey: true, key: "ArrowDown" });
  assert.deepEqual(fieldIds(designer.latest), [
    "reason",
    "date",
    "amount",
    "remarks",
  ]);
});

test("从控件库拖入字段前精确插入，拖入末尾不替换已有字段", () => {
  const source = sampleSpec();
  const designer = mountDesigner(source);
  const dataTransfer = transfer();
  fireEvent.dragStart(
    screen.getByRole("button", { name: "添加单选", exact: true }),
    { dataTransfer },
  );
  fireEvent.dragOver(fieldCard("date"), { dataTransfer });
  assert.equal(fieldCard("date").classList.contains("is-drop-target"), true);
  fireEvent.drop(fieldCard("date"), { dataTransfer });
  assert.deepEqual(
    fieldIds(designer.latest).filter((id) => id !== "field_1"),
    fieldIds(source),
  );
  assert.equal(designer.latest.fields[2].type, "SINGLE");
  assert.equal(fieldCard("field_1").getAttribute("aria-pressed"), "true");
  fireEvent.dragStart(
    screen.getByRole("button", { name: "添加附件", exact: true }),
    { dataTransfer },
  );
  fireEvent.drop(document.querySelector(".workflow-form-drop-end")!, {
    dataTransfer,
  });
  assert.equal(designer.latest.fields.at(-1)!.type, "FILES");
  assert.equal(designer.changes.length, 2);
});

test("跨多项拖动使用移除后插入，中间项不因远距离交换被打乱", () => {
  const source = sampleSpec();
  const original = structuredClone(source);
  const designer = mountDesigner(source);
  const dataTransfer = transfer();
  fireEvent.dragStart(fieldCard("reason"), { dataTransfer });
  fireEvent.dragOver(fieldCard("remarks"), { dataTransfer });
  fireEvent.drop(fieldCard("remarks"), { dataTransfer });
  assert.deepEqual(fieldIds(designer.latest), [
    "amount",
    "date",
    "reason",
    "remarks",
  ]);
  fireEvent.dragStart(fieldCard("amount"), { dataTransfer });
  fireEvent.drop(document.querySelector(".workflow-form-drop-end")!, {
    dataTransfer,
  });
  assert.deepEqual(fieldIds(designer.latest), [
    "date",
    "reason",
    "remarks",
    "amount",
  ]);
  assert.deepEqual(designer.latest.nodes, original.nodes);
  assert.deepEqual(source, original);
});

test("外部伪造拖放和已结束的拖放均不能修改表单模型", () => {
  const designer = mountDesigner(sampleSpec());
  const dataTransfer = transfer();
  dataTransfer.setData(
    "application/x-mayday-workflow-field",
    JSON.stringify({ kind: "control", type: "MONEY" }),
  );
  fireEvent.dragOver(fieldCard("reason"), { dataTransfer });
  fireEvent.drop(fieldCard("reason"), { dataTransfer });
  assert.equal(designer.changes.length, 0);
  fireEvent.dragStart(fieldCard("amount"), { dataTransfer });
  fireEvent.dragEnd(fieldCard("amount"), { dataTransfer });
  fireEvent.drop(fieldCard("reason"), { dataTransfer });
  assert.equal(designer.changes.length, 0);
});

test("条件引用中的字段禁止删除，明确提示应先修改分支且不显示确认框", async () => {
  const source = sampleSpec();
  source.nodes.unshift({
    id: "amount_rule",
    name: "费用金额分流",
    type: "CONDITION",
    next: "review",
    conditions: [
      { field: "amount", operator: "GT", value: "500", next: "review" },
    ],
  });
  source.startNodeId = "amount_rule";
  const designer = mountDesigner(source);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "删除申请金额", exact: true }),
  );
  assert.ok(await screen.findByText(/费用金额分流.*先修改分支条件/));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(designer.changes.length, 0);
  assert.deepEqual(designer.latest, source);
});

test("删除先确认，取消保留字段；确认删除清理节点授权但不改流程连线", async () => {
  const source = sampleSpec();
  const original = structuredClone(source);
  const designer = mountDesigner(source);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "删除申请事由", exact: true }),
  );
  let dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: /^(Cancel|取\s*消)$/ }),
  );
  assert.equal(designer.changes.length, 0);
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await user.click(
    screen.getByRole("button", { name: "删除申请事由", exact: true }),
  );
  dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: /^(OK|确\s*定)$/ }),
  );
  await waitFor(() => assert.equal(designer.latest.fields.length, 3));
  assert.equal(
    designer.latest.fields.some((field) => field.id === "reason"),
    false,
  );
  assert.deepEqual(designer.latest.nodes[0].readable, [
    "amount",
    "date",
    "remarks",
  ]);
  assert.deepEqual(designer.latest.nodes[0].writable, []);
  assert.equal(designer.latest.nodes[0].next, "end");
  assert.deepEqual(source, original);
});

test("设计态人员、部门、附件只是 inert 外观，不读取通讯录或上传网络", async () => {
  const designer = mountDesigner(
    sampleSpec([
      { id: "person", label: "联系人", type: "USER" },
      { id: "department", label: "所属部门", type: "DEPARTMENT" },
      { id: "attachment", label: "证明附件", type: "FILES" },
    ]),
  );
  const user = userEvent.setup();
  for (const id of ["person", "department", "attachment"]) {
    const control = fieldCard(id).querySelector(
      ".workflow-form-design-control",
    )!;
    assert.equal(control.hasAttribute("inert"), true);
    assert.equal(control.getAttribute("aria-hidden"), "true");
    await user.click(fieldCard(id));
  }
  assert.equal(document.querySelector('input[type="file"]'), null);
  assert.equal(requests.length, 0);
  assert.equal(designer.changes.length, 0);
});

test("只读模式禁用控件和属性，快捷键及伪造拖放不触发修改或撤销回调", async () => {
  const designer = mountDesigner(sampleSpec(), false);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "添加金额", exact: true }),
  );
  await user.click(fieldCard("amount"));
  assert.equal(
    (screen.getByLabelText("字段标题") as HTMLInputElement).disabled,
    true,
  );
  fireEvent.change(screen.getByLabelText("字段标题"), {
    target: { value: "强制改名" },
  });
  fireEvent.keyDown(fieldCard("amount"), { altKey: true, key: "ArrowUp" });
  const dataTransfer = transfer();
  fireEvent.dragStart(fieldCard("amount"), { dataTransfer });
  fireEvent.drop(fieldCard("reason"), { dataTransfer });
  assert.equal(screen.queryByRole("button", { name: "复制申请金额" }), null);
  assert.equal(screen.queryByRole("button", { name: "撤销表单修改" }), null);
  assert.equal(designer.changes.length, 0);
  assert.equal(designer.undoCount, 0);
  assert.equal(designer.redoCount, 0);
});

test("容器变窄后用控件与属性弹窗完成添加，关闭弹窗不删除新字段", async () => {
  const designer = mountDesigner(sampleSpec([]));
  const user = userEvent.setup();
  await resizeWorkspace(390);
  assert.equal(
    screen.queryByRole("complementary", { name: "表单控件库" }),
    null,
  );
  await user.click(
    screen.getByRole("button", { name: "添加控件", exact: true }),
  );
  let dialog = await screen.findByRole("dialog");
  assert.ok(
    within(dialog).getByText("添加控件", { selector: ".ant-modal-title" }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "添加单行文字", exact: true }),
  );
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1));
  dialog = screen.getByRole("dialog");
  assert.ok(within(dialog).getByLabelText("字段标题"));
  assert.equal(document.querySelector(".ant-drawer"), null);
  fireEvent.change(within(dialog).getByLabelText("字段标题"), {
    target: { value: "客户姓名" },
  });
  await user.click(within(dialog).getByRole("button", { name: /^完\s*成$/ }));
  assert.equal(designer.latest.fields[0].label, "客户姓名");
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await user.click(fieldCard(designer.latest.fields[0].id));
  assert.ok(await screen.findByRole("dialog"));
});

test("填写预览支持电脑和手机切换，检查和清空只作用于试填表单", async () => {
  const source = sampleSpec([
    {
      id: "reason",
      label: "申请事由",
      type: "TEXT",
      required: true,
      maxLength: 100,
      width: 24,
    },
  ]);
  const designer = mountDesigner(source);
  const user = userEvent.setup();
  await user.click(
    screen.getByText("填写预览", { selector: ".ant-segmented-item-label" }),
  );
  const stage = screen.getByRole("main", { name: "表单填写预览" });
  assert.equal(
    screen.queryByRole("complementary", { name: "表单控件库" }),
    null,
  );
  await user.click(
    within(stage).getByRole("button", { name: "检查填写", exact: true }),
  );
  assert.ok(await within(stage).findByText("请填写申请事由"));
  await user.type(within(stage).getByLabelText("申请事由"), "差旅费用测试");
  await user.click(
    within(stage).getByRole("button", { name: "检查填写", exact: true }),
  );
  assert.ok(await screen.findByText("填写检查通过，未提交业务数据"));
  const deviceSelector = screen.getByLabelText("表单预览尺寸");
  await user.click(
    within(deviceSelector)
      .getByRole("radio", { name: "手机" })
      .closest("label")!,
  );
  assert.equal(
    stage
      .querySelector(".workflow-form-sheet")!
      .classList.contains("is-mobile"),
    true,
  );
  await user.click(
    within(deviceSelector)
      .getByRole("radio", { name: "桌面" })
      .closest("label")!,
  );
  assert.equal(
    stage
      .querySelector(".workflow-form-sheet")!
      .classList.contains("is-mobile"),
    false,
  );
  await user.click(
    within(stage).getByRole("button", { name: "清空填写", exact: true }),
  );
  assert.equal(
    (within(stage).getByLabelText("申请事由") as HTMLInputElement).value,
    "",
  );
  assert.equal(designer.changes.length, 0);
  assert.equal(requests.length, 0);
  assert.deepEqual(designer.latest, source);
});

test("撤销和重做向父层发事件，搜索控件不改变模型", async () => {
  const designer = mountDesigner(sampleSpec());
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "撤销表单修改", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "重做表单修改", exact: true }),
  );
  await user.type(screen.getByLabelText("搜索控件"), "金额");
  assert.ok(screen.getByRole("button", { name: "添加金额", exact: true }));
  assert.equal(
    screen.queryByRole("button", { name: "添加单行文字", exact: true }),
    null,
  );
  assert.equal(designer.undoCount, 1);
  assert.equal(designer.redoCount, 1);
  assert.equal(designer.changes.length, 0);
});

test("填写预览拒绝不完整和逆序日期区间，修正后才提示检查通过", async () => {
  const designer = mountDesigner(
    sampleSpec([
      {
        id: "travel_dates",
        label: "出差时间",
        type: "DATE_RANGE",
        required: true,
        width: 24,
      },
    ]),
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByText("填写预览", { selector: ".ant-segmented-item-label" }),
  );
  const stage = screen.getByRole("main", { name: "表单填写预览" });
  const check = within(stage).getByRole("button", {
    name: "检查填写",
    exact: true,
  });
  fireEvent.change(within(stage).getByLabelText("开始日期"), {
    target: { value: "2026-10-10" },
  });
  await user.click(check);
  assert.ok(
    await within(stage).findByText(
      "出差时间日期区间格式无效，请填写完整的有效日期",
    ),
  );
  assert.equal(screen.queryByText("填写检查通过，未提交业务数据"), null);
  // 原生输入 min 属性不能代替跨字段校验，程序、键盘或旧草稿仍可能给出逆序值。
  fireEvent.change(within(stage).getByLabelText("结束日期"), {
    target: { value: "2026-10-09" },
  });
  await user.click(check);
  assert.ok(await within(stage).findByText("出差时间结束日期不能早于开始日期"));
  assert.equal(screen.queryByText("填写检查通过，未提交业务数据"), null);
  fireEvent.change(within(stage).getByLabelText("结束日期"), {
    target: { value: "2026-10-12" },
  });
  await user.click(check);
  assert.ok(await screen.findByText("填写检查通过，未提交业务数据"));
  assert.equal(designer.changes.length, 0);
  assert.equal(requests.length, 0);
});

test("填写预览校验明细行的必填列，空行不能误报通过且修正后可继续检查", async () => {
  const designer = mountDesigner(
    sampleSpec([
      {
        id: "items",
        label: "费用明细",
        type: "DETAILS",
        required: true,
        width: 24,
        maxRows: 5,
        columns: [
          { id: "item", label: "项目", type: "TEXT", required: true },
          {
            id: "fee",
            label: "金额",
            type: "MONEY",
            required: true,
            min: 0,
          },
        ],
      },
    ]),
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByText("填写预览", { selector: ".ant-segmented-item-label" }),
  );
  const stage = screen.getByRole("main", { name: "表单填写预览" });
  await user.click(
    within(stage).getByRole("button", { name: "添加明细 (0/5)" }),
  );
  const check = within(stage).getByRole("button", {
    name: "检查填写",
    exact: true,
  });
  await user.click(check);
  assert.ok(await within(stage).findByText("第 1 行，项目不能为空"));
  assert.ok(await within(stage).findByText("第 1 行，金额不能为空"));
  assert.equal(screen.queryByText("填写检查通过，未提交业务数据"), null);
  await user.type(within(stage).getByLabelText("第1行项目"), "交通费用");
  await user.click(check);
  assert.ok(await within(stage).findByText("第 1 行，金额不能为空"));
  assert.equal(screen.queryByText("填写检查通过，未提交业务数据"), null);
  fireEvent.change(within(stage).getByLabelText("第1行金额"), {
    target: { value: "15.50" },
  });
  await user.click(check);
  assert.ok(await screen.findByText("填写检查通过，未提交业务数据"));
  assert.equal(designer.changes.length, 0);
  assert.equal(requests.length, 0);
});
