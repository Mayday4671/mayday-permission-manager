import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import type { WorkflowNode } from "../src/types/workflow";
const styles = nodeModule.registerHooks?.({
  load(url, context, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "", shortCircuit: true }
      : next(url, context);
  },
});
if (!styles)
  nodeModule.register(
    `data:text/javascript,${encodeURIComponent('export async function load(url,context,next){return url.endsWith(".css")?{format:"module",source:"",shortCircuit:true}:next(url,context);}')} `,
    import.meta.url,
  );

/** 真实 Ant 选择器与查询边界回归：绑定旧版本、映射范围、切版清空及加载失败均保留受控状态。 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLBodyElement",
  "HTMLHtmlElement",
  "Document",
  "Element",
  "SVGElement",
  "ShadowRoot",
  "Node",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "sessionStorage",
  "localStorage",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const channels = [],
  NativeMessageChannel = globalThis.MessageChannel;
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
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const React = await import("react"),
  { useState } = React;
const { render, screen, cleanup, waitFor, within, act } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { WorkflowSubprocessEditor } =
  await import("../src/components/workflow/WorkflowSubprocessEditor");
const { ApprovalDetailModal } =
  await import("../src/components/ApprovalDetailModal");
const { ApprovalSubmitModal } =
  await import("../src/components/ApprovalSubmitModal");
const { AuthProvider } = await import("../src/lib/auth");
const originalFetch = globalThis.fetch,
  clients: InstanceType<typeof QueryClient>[] = [];
const calls: string[] = [];
const decisions: Record<string, unknown>[] = [];
let denied = false;
let repairTesting = false;
let taskTesting = false;
let rejectSelectedTask = false;
let delayRightTask = false;
let resolveRightTask: ((response: Response) => void) | undefined;
let submitTesting = false;
let privateDraftTesting = false;
let reminderTesting: "waiting" | "cooldown" | "active" | null = null;
let reminderVersion = 3;
let reminderConflict = true;
const reminderSends: Record<string, unknown>[] = [];
const privateDraftSaves: Record<string, unknown>[] = [];
const submissions: Record<string, unknown>[] = [];
const repairs: Record<string, unknown>[] = [];
globalThis.fetch = async (input, options) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    "http://localhost",
  );
  calls.push(url.pathname + url.search);
  if (submitTesting && url.pathname === "/api/operations/workflows/options")
    return Response.json({ success: true, data: [submitOption(1)] });
  if (
    submitTesting &&
    ["/api/operations/requests", "/api/operations/requests/drafts"].includes(
      url.pathname,
    )
  ) {
    submissions.push(JSON.parse(String(options?.body)));
    return Response.json(
      { success: false, message: "流程发布版本已变化，请重新打开申请" },
      { status: 409 },
    );
  }
  if (url.pathname.endsWith("/subprocess-repair-options"))
    return Response.json({
      success: true,
      data: [
        {
          tokenId: "fixed-call-token",
          callerNodeId: "child",
          callerName: "采购子调用",
          versionId: 11,
          nodes: [
            {
              id: "review",
              name: "采购审批",
              type: "APPROVAL",
              source: "USERS",
              sourceIds: [7],
              people: [{ value: 7, label: "离职人员（已停用）" }],
            },
            {
              id: "copy",
              name: "业务抄送",
              type: "COPY",
              source: "USERS",
              sourceIds: [8],
              people: [{ value: 8, label: "已删除账号 #8" }],
            },
          ],
        },
      ],
    });
  if (url.pathname.endsWith("/subprocess-repair")) {
    repairs.push(JSON.parse(String(options?.body)));
    return Response.json(
      { success: false, message: "修复版本已过期，请刷新后重新核对" },
      { status: 409 },
    );
  }
  if (url.pathname === "/api/auth/me")
    return Response.json({
      success: true,
      data: {
        user: { id: 101, nickname: "合成审批人" },
        permissions: repairTesting
          ? [
              "requests:view",
              "requests:approve",
              "requests:manage",
              "requests:reassign",
              "users:view",
            ]
          : reminderTesting
            ? ["requests:view", "requests:remind"]
            : ["requests:view", "requests:approve"],
        dataScopes: {},
      },
    });
  if (url.pathname === "/api/platform/features")
    return Response.json({
      success: true,
      data: { modules: { approvals: true } },
    });
  if (url.pathname.endsWith("/events"))
    return Response.json({ success: true, data: [] });
  if (url.pathname.startsWith("/api/system/options/"))
    return Response.json({
      success: true,
      data: {
        items: repairTesting ? [{ value: 23, label: "有效接收人" }] : [],
        total: repairTesting ? 1 : 0,
        page: 1,
        size: 10,
      },
    });
  if (privateDraftTesting && url.pathname.endsWith("/8/submit")) {
    privateDraftSaves.push(JSON.parse(String(options?.body)));
    return Response.json(
      { success: false, message: "提交状态已变化，请刷新并重新核对" },
      { status: 409 },
    );
  }
  if (url.pathname.endsWith("/remind")) {
    reminderSends.push(JSON.parse(String(options?.body)));
    if (reminderConflict)
      return Response.json(
        { success: false, message: "催办版本已变化，请刷新后重新确认" },
        { status: 409 },
      );
    reminderTesting = "cooldown";
    reminderVersion++;
    return Response.json({ success: true, data: null });
  }
  if (url.pathname.endsWith("/decision")) {
    decisions.push(JSON.parse(String(options?.body)));
    return Response.json(
      { success: false, message: "数据已被其他人修改，请刷新后重试" },
      { status: 409 },
    );
  }
  if (/^\/api\/operations\/requests\/\d+$/.test(url.pathname))
    if (taskTesting) {
      const selected = Number(url.searchParams.get("taskId") ?? 41);
      if (selected === 42 && rejectSelectedTask)
        return Response.json(
          { success: false, message: "不是本人当前有效待办，请重新选择" },
          { status: 403 },
        );
      if (selected === 42 && delayRightTask) {
        delayRightTask = false;
        // 刻意模拟忽略 AbortSignal 的迟到后端；组件查询代际仍须排除过期返回。
        return new Promise<Response>((resolve) => {
          resolveRightTask = resolve;
        });
      }
      return Response.json({ success: true, data: taskDetail(selected) });
    } else
      return Response.json({
        success: true,
        data: approvalDetail(Number(url.pathname.split("/").at(-1))),
      });
  const old = url.pathname.endsWith("/11");
  const data = url.pathname.includes("subprocess-options")
    ? {
        items: [{ id: 7, name: "费用审批", versionId: 12, versionNumber: 2 }],
        total: 1,
        page: 1,
        size: 10,
      }
    : {
        definitionId: 7,
        name: "费用审批",
        versionId: old ? 11 : 12,
        versionNumber: old ? 1 : 2,
        fields: [
          {
            id: old ? "memo" : "newMemo",
            label: old ? "说明" : "二版说明",
            type: "TEXT",
            required: true,
          },
          { id: "result", label: "结果", type: "NUMBER" },
        ],
      };
  return new Response(
    JSON.stringify(
      denied && old
        ? { success: false, data: null, message: "固定版本无权读取" }
        : { success: true, data },
    ),
    {
      status: denied && old ? 403 : 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  calls.length = 0;
  decisions.length = 0;
  repairs.length = 0;
  repairTesting = false;
  taskTesting = false;
  rejectSelectedTask = false;
  delayRightTask = false;
  resolveRightTask = undefined;
  submitTesting = false;
  privateDraftTesting = false;
  reminderTesting = null;
  reminderVersion = 3;
  reminderConflict = true;
  reminderSends.length = 0;
  privateDraftSaves.length = 0;
  submissions.length = 0;
  denied = false;
  sessionStorage.clear();
  localStorage.clear();
});
after(() => {
  globalThis.fetch = originalFetch;
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

/** 父层及时回写绑定，后续查询与选择必须使用新值而不是把初始模型原地修改。 */
function mount() {
  const initial = {
      versionId: 11,
      inputs: { memo: "memo" },
      outputs: { amount: "result" },
    },
    changes: NonNullable<WorkflowNode["subprocess"]>[] = [];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  let latest = initial;
  function Harness() {
    const [binding, setBinding] =
      useState<NonNullable<WorkflowNode["subprocess"]>>(initial);
    return (
      <QueryClientProvider client={client}>
        <ConfigProvider theme={{ token: { motion: false } }}>
          <App>
            <WorkflowSubprocessEditor
              value={binding}
              onChange={(next) => {
                latest = next;
                changes.push(next);
                setBinding(next);
              }}
              fields={[
                { id: "memo", label: "父说明", type: "TEXT" },
                { id: "secret", label: "私密字段", type: "TEXT" },
                { id: "amount", label: "父金额", type: "MONEY" },
              ]}
              readable={["memo"]}
              writable={["amount"]}
            />
          </App>
        </ConfigProvider>
      </QueryClientProvider>
    );
  }
  render(<Harness />);
  return {
    changes,
    get latest() {
      return latest;
    },
  };
}
test("已绑定旧版只加载旧字段，输入选择不提供未读授权或异型字段", async () => {
  const view = mount(),
    user = userEvent.setup();
  await screen.findByText("说明 *");
  assert(calls.some((path) => path.endsWith("/subprocess-versions/11")));
  assert.equal(
    calls.some((path) => path.endsWith("/subprocess-versions/12")),
    false,
  );
  await user.click(screen.getByLabelText("子流程输入：说明"));
  await waitFor(() =>
    assert.ok(document.querySelector(".ant-select-dropdown")),
  );
  const popup = within(document.querySelector(".ant-select-dropdown")!);
  assert.equal(popup.queryByText("私密字段"), null);
  assert.equal(popup.queryByText("父金额"), null);
  assert.equal(view.latest.versionId, 11);
  assert.equal(view.changes.length, 0);
});
test("主动切换发布版本清空旧输入输出映射并重新加载新版本字段", async () => {
  const view = mount(),
    user = userEvent.setup();
  await screen.findByText("说明 *");
  await user.click(screen.getByLabelText("子流程发布版本"));
  await user.click(await screen.findByText("费用审批 · 版本 2"));
  await screen.findByText("二版说明 *");
  assert.deepEqual(view.latest, { versionId: 12, inputs: {}, outputs: {} });
});
test("固定版本读取拒绝保留旧绑定和映射，明确错误而不是切到最新版本", async () => {
  denied = true;
  const view = mount();
  await screen.findByText("固定版本无权读取");
  assert.equal(view.latest.versionId, 11);
  assert.deepEqual(view.latest.inputs, { memo: "memo" });
  assert.equal(view.changes.length, 0);
});

/** 最小合成详情仍包含生产组件依赖的完整表单/办理契约，不连接任何真实申请。 */
function approvalDetail(id: number) {
  if (reminderTesting)
    return {
      ...baseApprovalDetail(id),
      version: reminderVersion,
      applicantId: 101,
      myTaskId: null,
      actions: [],
      writable: [],
      canRemind: reminderTesting === "active",
      remindUnavailableReason:
        reminderTesting === "active"
          ? null
          : reminderTesting === "waiting"
            ? "当前没有可催办的待办"
            : "每项申请 30 分钟内只能催办一次",
    };
  if (privateDraftTesting)
    return {
      ...baseApprovalDetail(id),
      title: "申请人私人标题",
      applicantId: 101,
      status: "RETURNED",
      hasPrivateDraft: true,
      values: { memo: "申请人保存的新值" },
      myTaskId: null,
      actions: [],
      writable: [],
      canEdit: true,
    };
  return baseApprovalDetail(id);
}
function baseApprovalDetail(id: number) {
  return {
    id,
    version: 1,
    title: id === 8 ? "父申请详情" : "子申请详情",
    definitionName: "合成审批",
    definitionVersionNumber: 1,
    status: "PENDING",
    applicantId: 999,
    applicantName: "测试申请人",
    fields: [{ id: "memo", label: "说明", type: "TEXT", required: true }],
    values: { memo: "旧值" },
    valueLabels: {},
    files: [],
    tasks: [],
    history: [],
    myTaskId: 41,
    actions: ["APPROVE"],
    writable: ["memo"],
    canWithdraw: false,
    canComment: false,
    canRemind: false,
    canEdit: false,
    canTerminate: false,
    canRepairSubprocess: repairTesting,
    returnTargets: [],
    unreadCopies: 0,
    diagram: { startNodeId: "review", nodes: [] },
    business: null,
    execution: [],
    childRequests:
      id === 8
        ? [
            {
              id: 9,
              name: "子申请",
              status: "PENDING",
              versionId: 11,
              canView: true,
            },
          ]
        : [],
    parentRequestId: id === 9 ? 8 : null,
    canViewParent: id === 9,
  };
}

/** 两个本人支路具有不同字段、动作及退回路径，选择不能由前端模型推断。 */
function taskDetail(taskId: number) {
  const right = taskId === 42;
  return {
    ...approvalDetail(8),
    version: right ? 7 : 3,
    currentNodeName: right ? "右节点办理" : "左节点办理",
    fields: [
      { id: "left", label: "左字段", type: "TEXT" },
      { id: "right", label: "右字段", type: "TEXT" },
    ],
    values: { left: "左原值", right: "右原值" },
    myTaskId: taskId,
    myTasks: [
      { id: 41, nodeId: "left", nodeName: "左支路" },
      { id: 42, nodeId: "right", nodeName: "右支路" },
    ],
    actions: right ? ["APPROVE", "RETURN", "REJECT"] : ["APPROVE", "COMMENT"],
    writable: [right ? "right" : "left"],
    canComment: !right,
    returnTargets: [
      {
        id: right ? "rightGate" : "leftGate",
        name: right ? "右前置节点" : "左前置节点",
      },
    ],
  };
}

function submitOption(version: number) {
  return {
    id: 22,
    name: "版本冻结申请",
    categoryId: 1,
    businessType: "GENERAL",
    versionId: version === 1 ? 2201 : 2202,
    versionNumber: version,
    fields: [
      {
        id: version === 1 ? "oldMemo" : "newMemo",
        label: version === 1 ? "一版说明" : "二版说明",
        type: "TEXT",
        required: true,
      },
    ],
  };
}

function mountSubmission() {
  sessionStorage.setItem("mayday.session", "synthetic-session");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <AuthProvider>
            <ApprovalSubmitModal open onClose={() => {}} />
          </AuthProvider>
        </App>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return client;
}
function mountDetail() {
  sessionStorage.setItem("mayday.session", "synthetic-session");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <AuthProvider>
            <ApprovalDetailModal id={8} onClose={() => {}} />
          </AuthProvider>
        </App>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return client;
}
test("办理弹窗固定打开时版本、待办和字段，轮询不能替用户自动确认新版本", async () => {
  const client = mountDetail(),
    user = userEvent.setup();
  await screen.findByText("父申请详情");
  await user.click(screen.getByRole("button", { name: /^同\s*意$/ }));
  const dialog = await screen.findByRole("dialog", { name: "同意审批" });
  await act(async () => {
    client.setQueriesData(
      { queryKey: ["approvals", "detail", 8] },
      {
        ...approvalDetail(8),
        version: 2,
        myTaskId: 51,
        values: { memo: "新值" },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await user.click(within(dialog).getByRole("button", { name: /^同\s*意$/ }));
  await screen.findByText("数据已被其他人修改，请刷新后重试");
  assert.equal(decisions[0].version, 1);
  assert.equal(decisions[0].taskId, 41);
  assert.deepEqual(decisions[0].values, { memo: "旧值" });
  assert.equal(
    within(dialog).getByRole("textbox", { name: "说明" }).getAttribute("value"),
    "旧值",
  );
});
test("父子详情沿关系在同一弹窗导航，多次往返不堆叠递归弹窗", async () => {
  mountDetail();
  const user = userEvent.setup();
  await screen.findByText("父申请详情");
  await user.click(screen.getByRole("tab", { name: "执行状态" }));
  await user.click(await screen.findByRole("button", { name: "查看申请" }));
  await screen.findByText("子申请详情");
  assert.equal(screen.getAllByRole("dialog", { name: "审批详情" }).length, 1);
  await user.click(screen.getByRole("button", { name: "查看父申请" }));
  await screen.findByText("父申请详情");
  assert.equal(screen.getAllByRole("dialog", { name: "审批详情" }).length, 1);
});

test("待启动子流程人员修复读取固定来源，提交固定版本并在冲突后保留输入", async () => {
  repairTesting = true;
  const client = mountDetail();
  const user = userEvent.setup();
  await screen.findByText("父申请详情");
  await user.click(screen.getByRole("button", { name: "修复子流程人员" }));
  const dialog = await screen.findByRole("dialog", { name: "修复子流程人员" });
  await user.click(
    await within(dialog).findByRole("combobox", { name: "待启动调用" }),
  );
  await user.click(await screen.findByText("采购子调用 · 固定版本 11"));
  await user.click(
    within(dialog).getByRole("combobox", { name: "子流程人员节点" }),
  );
  await user.click(await screen.findByText("采购审批 · 审批"));
  await screen.findByText("离职人员（已停用）");
  await user.click(
    within(dialog).getByRole("combobox", { name: "新处理人员" }),
  );
  await user.click(await screen.findByText("有效接收人"));
  await user.type(
    within(dialog).getByRole("textbox", { name: "修复原因" }),
    "离职人员交接给有效接收人",
  );
  // 更新真实父层查询，修复弹窗仍保留打开时的克隆快照，不使用轮询后的版本。
  await act(async () => {
    client.setQueriesData(
      { queryKey: ["approvals", "detail", 8] },
      {
        ...approvalDetail(8),
        version: 2,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await user.click(
    within(dialog).getByRole("button", { name: "保存人员修复" }),
  );
  await screen.findByText("修复版本已过期，请刷新后重新核对");
  assert.deepEqual(repairs[0], {
    version: 1,
    tokenId: "fixed-call-token",
    childNodeId: "review",
    targetUserIds: [23],
    reason: "离职人员交接给有效接收人",
  });
  assert.equal(
    (
      within(dialog).getByRole("textbox", {
        name: "修复原因",
      }) as HTMLTextAreaElement
    ).value,
    "离职人员交接给有效接收人",
  );
  assert(calls.some((path) => path.endsWith("/8/subprocess-repair-options")));
  assert.equal(
    calls.some((path) => path.includes("subprocess-versions/12")),
    false,
  );
});

test("同人并行选择右待办使用服务器字段和动作，冲突保留右支路意见", async () => {
  taskTesting = true;
  mountDetail();
  const user = userEvent.setup();
  await screen.findByText("左节点办理");
  await user.click(screen.getByRole("combobox", { name: "办理节点" }));
  await user.click(await screen.findByText("右支路"));
  await screen.findByText("右节点办理");
  assert.equal(!!screen.queryByRole("button", { name: /^评\s*论$/ }), false);
  assert.equal(!!screen.queryByRole("button", { name: /^退\s*回$/ }), true);
  assert(calls.some((path) => path.endsWith("/8?taskId=42")));
  await user.click(screen.getByRole("button", { name: /^同\s*意$/ }));
  const dialog = await screen.findByRole("dialog", { name: "同意审批" });
  assert.equal(
    !!within(dialog).queryByRole("textbox", { name: "左字段" }),
    false,
  );
  const value = within(dialog).getByRole("textbox", { name: "右字段" });
  await user.clear(value);
  await user.type(value, "右意见改后");
  await user.click(within(dialog).getByRole("button", { name: /^同\s*意$/ }));
  await screen.findByText("数据已被其他人修改，请刷新后重试");
  assert.equal(decisions[0].version, 7);
  assert.equal(decisions[0].taskId, 42);
  assert.deepEqual(decisions[0].values, { right: "右意见改后" });
  assert.equal((value as HTMLInputElement).value, "右意见改后");
});

test("切换支路清空原操作草稿，右待办退回只显示服务器右支路目标", async () => {
  taskTesting = true;
  mountDetail();
  const user = userEvent.setup();
  await screen.findByText("左节点办理");
  await user.click(screen.getByRole("button", { name: /^同\s*意$/ }));
  const original = await screen.findByRole("dialog", { name: "同意审批" });
  await user.type(
    within(original).getByRole("textbox", { name: "处理意见" }),
    "左草稿不能带到右支路",
  );
  await user.click(within(original).getByRole("button", { name: /^取\s*消$/ }));
  const discard = await screen.findByRole("dialog", {
    name: "放弃未保存的修改？",
  });
  await user.click(within(discard).getByRole("button", { name: "放弃修改" }));
  await waitFor(() =>
    assert.equal(!!screen.queryByRole("dialog", { name: "同意审批" }), false),
  );
  await user.click(screen.getByRole("combobox", { name: "办理节点" }));
  await user.click(await screen.findByText("右支路"));
  await screen.findByText("右节点办理");
  await user.click(screen.getByRole("button", { name: /^退\s*回$/ }));
  const dialog = await screen.findByRole("dialog", { name: "退回审批" });
  assert.equal(
    (
      within(dialog).getByRole("textbox", {
        name: "处理意见",
      }) as HTMLTextAreaElement
    ).value,
    "",
  );
  await user.click(within(dialog).getByRole("combobox", { name: "退回位置" }));
  await screen.findByText("右前置节点 · 重新办理后继续流程");
  assert.equal(!!screen.queryByText("左前置节点 · 重新办理后继续流程"), false);
  await user.click(screen.getByText("右前置节点 · 重新办理后继续流程"));
  await user.type(
    within(dialog).getByRole("textbox", { name: "处理意见" }),
    "右支路补充",
  );
  await user.click(within(dialog).getByRole("button", { name: /^退\s*回$/ }));
  await screen.findByText("数据已被其他人修改，请刷新后重试");
  assert.equal(decisions[0].taskId, 42);
  assert.equal(decisions[0].targetNodeId, "rightGate");
});

test("迟到的右待办响应不能覆盖切回左待办，失效任务可重新取当前待办", async () => {
  taskTesting = true;
  mountDetail();
  const user = userEvent.setup();
  await screen.findByText("左节点办理");
  delayRightTask = true;
  await user.click(screen.getByRole("combobox", { name: "办理节点" }));
  await user.click(await screen.findByText("右支路"));
  await waitFor(() => assert.equal(typeof resolveRightTask, "function"));
  assert.equal(!!screen.queryByRole("button", { name: /^同\s*意$/ }), false);
  await user.click(screen.getByRole("combobox", { name: "办理节点" }));
  await user.click(await screen.findByText("左支路"));
  await screen.findByText("左节点办理");
  await act(async () => {
    resolveRightTask!(
      Response.json({
        success: true,
        data: { ...taskDetail(42), version: 99 },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(!!screen.queryByText("右节点办理"), false);
  assert.equal(!!screen.queryByRole("button", { name: /^评\s*论$/ }), true);
  rejectSelectedTask = true;
  await user.click(screen.getByRole("combobox", { name: "办理节点" }));
  await user.click(await screen.findByText("右支路"));
  await screen.findByText("不是本人当前有效待办，请重新选择");
  assert.equal(!!screen.queryByRole("button", { name: /^同\s*意$/ }), false);
  await user.click(screen.getByRole("button", { name: "重新加载当前待办" }));
  await screen.findByText("左节点办理");
  assert.equal(!!screen.queryByRole("button", { name: /^评\s*论$/ }), true);
});

test("发起填写冻结已选发布版本，目录更新后提交旧版且409保留原字段和值", async () => {
  submitTesting = true;
  const client = mountSubmission(),
    user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: "发起审批" });
  await user.click(
    await within(dialog).findByRole("combobox", { name: "审批流程" }),
  );
  await user.click(await screen.findByText("版本冻结申请 · 版本 1"));
  await user.type(
    within(dialog).getByRole("textbox", { name: "申请标题" }),
    "填写时不能自动切版",
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "一版说明" }),
    "原版本字段草稿",
  );
  await act(async () => {
    client.setQueryData(["workflow-options", "GENERAL"], [submitOption(2)]);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await screen.findByText(
    "流程已发布版本 2，当前表单仍使用版本 1。请重新选择流程后按新版本填写。",
  );
  assert.equal(
    !!within(dialog).queryByRole("textbox", { name: "二版说明" }),
    false,
  );
  await user.click(within(dialog).getByRole("button", { name: "提交申请" }));
  await screen.findByText("流程发布版本已变化，请重新打开申请");
  assert.equal(submissions[0].definitionId, 22);
  assert.equal(submissions[0].versionId, 2201);
  assert.deepEqual(submissions[0].values, { oldMemo: "原版本字段草稿" });
  assert.equal(
    (
      within(dialog).getByRole("textbox", {
        name: "一版说明",
      }) as HTMLInputElement
    ).value,
    "原版本字段草稿",
  );
  assert.equal(
    (
      within(dialog).getByRole("textbox", {
        name: "申请标题",
      }) as HTMLInputElement
    ).value,
    "填写时不能自动切版",
  );
  await user.click(within(dialog).getByRole("combobox", { name: "审批流程" }));
  await user.click(await screen.findByText("版本冻结申请 · 版本 2"));
  const next = await within(dialog).findByRole("textbox", { name: "二版说明" });
  assert.equal((next as HTMLInputElement).value, "");
  assert.equal(
    !!within(dialog).queryByRole("textbox", { name: "一版说明" }),
    false,
  );
  await user.type(next, "主动切版的新字段");
  await user.click(within(dialog).getByRole("button", { name: "保存草稿" }));
  await waitFor(() => assert.equal(submissions.length, 2));
  assert.equal(submissions[1].versionId, 2202);
  assert.deepEqual(submissions[1].values, { newMemo: "主动切版的新字段" });
  await waitFor(() =>
    assert.equal(
      screen.getAllByText("流程发布版本已变化，请重新打开申请").length,
      2,
    ),
  );
  assert.equal((next as HTMLInputElement).value, "主动切版的新字段");
});

test("申请人恢复私稿显示未提交提示，重提冲突保留私人标题和字段输入", async () => {
  privateDraftTesting = true;
  mountDetail();
  const user = userEvent.setup();
  await screen.findByText("申请人私人标题");
  await screen.findByText(
    "当前显示你保存的未提交修改，仅你可见。其他参与者查看上一提交轮，重新提交后才进入审批。",
  );
  await user.click(screen.getByRole("button", { name: "修改并重新提交" }));
  const dialog = await screen.findByRole("dialog", { name: "修改申请" });
  const title = within(dialog).getByRole("textbox", { name: "申请标题" });
  const memo = within(dialog).getByRole("textbox", { name: "说明" });
  assert.equal((title as HTMLInputElement).value, "申请人私人标题");
  assert.equal((memo as HTMLInputElement).value, "申请人保存的新值");
  await user.type(memo, "继续补充");
  await user.click(within(dialog).getByRole("button", { name: "提交申请" }));
  await screen.findByText("提交状态已变化，请刷新并重新核对");
  assert.equal(privateDraftSaves.length, 1);
  assert.equal(privateDraftSaves[0].version, 1);
  assert.equal(privateDraftSaves[0].title, "申请人私人标题");
  assert.deepEqual(privateDraftSaves[0].values, {
    memo: "申请人保存的新值继续补充",
  });
  assert.equal((memo as HTMLInputElement).value, "申请人保存的新值继续补充");
  assert.equal((title as HTMLInputElement).value, "申请人私人标题");
});

test("无活动待办与冷却分别显示服务端原因，禁用催办不能打开确认或发请求", async () => {
  reminderTesting = "waiting";
  const client = mountDetail(),
    user = userEvent.setup();
  await screen.findByText("父申请详情");
  let button = screen.getByRole("button", { name: /^催\s*办$/ });
  assert.equal((button as HTMLButtonElement).disabled, true);
  assert.equal(button.getAttribute("title"), "当前没有可催办的待办");
  await user.click(button);
  assert.equal(!!screen.queryByText("提醒所有当前审批人？"), false);
  assert.equal(reminderSends.length, 0);
  reminderTesting = "cooldown";
  await act(async () => {
    client.setQueriesData(
      { queryKey: ["approvals", "detail", 8] },
      approvalDetail(8),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  button = screen.getByRole("button", { name: /^催\s*办$/ });
  assert.equal((button as HTMLButtonElement).disabled, true);
  assert.equal(button.getAttribute("title"), "每项申请 30 分钟内只能催办一次");
  await user.click(button);
  assert.equal(reminderSends.length, 0);
});

test("催办确认固定打开版本，409不自动重试，重新确认成功后刷新冷却状态", async () => {
  reminderTesting = "active";
  const client = mountDetail(),
    user = userEvent.setup();
  await screen.findByText("父申请详情");
  await user.click(screen.getByRole("button", { name: /^催\s*办$/ }));
  await screen.findByText("提醒所有当前审批人？");
  reminderVersion = 9;
  await act(async () => {
    client.setQueriesData(
      { queryKey: ["approvals", "detail", 8] },
      approvalDetail(8),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  await user.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("催办版本已变化，请刷新后重新确认");
  assert.deepEqual(reminderSends, [{ version: 3 }]);
  assert(screen.getByText("父申请详情"));
  await waitFor(() => assert.equal(!!screen.queryByRole("tooltip"), false));
  reminderConflict = false;
  await user.click(screen.getByRole("button", { name: /^催\s*办$/ }));
  await screen.findByText("提醒所有当前审批人？");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("已安排催办通知");
  assert.deepEqual(reminderSends, [{ version: 3 }, { version: 9 }]);
  await waitFor(() => {
    const button = screen.getByRole("button", { name: /^催\s*办$/ });
    assert.equal((button as HTMLButtonElement).disabled, true);
    assert.equal(
      button.getAttribute("title"),
      "每项申请 30 分钟内只能催办一次",
    );
  });
});
