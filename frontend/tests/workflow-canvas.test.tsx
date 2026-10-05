import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowNode, WorkflowSpec } from "../src/types/workflow";

/**
 * 使用真实 Ant 浮层、确认框及 OA 画布，验证业务管理员点击的线路与实际修改出口一致。
 * 此环境不连接后端，不充当浏览器视觉验收，也不改动任何已发布流程或真实申请。
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
  "Document",
  "Element",
  "SVGElement",
  "ShadowRoot",
  "Node",
  "MutationObserver",
  "Event",
  "MouseEvent",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}
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

// DOM 必须先初始化，避免 Ant 和 Testing Library 在模块加载时缓存错误的运行环境。
const React = await import("react");
const { useState } = React;
const { render, screen, cleanup, waitFor, within } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { ConfigProvider, App } = await import("antd");
const { WorkflowCanvas } =
  await import("../src/components/workflow/WorkflowCanvas");
const { initialSpec } = await import("../src/types/workflow");

afterEach(() => cleanup());
after(() => {
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

/** 仅记录真实组件的变更回调；父层回写模型，保证下一次点击使用最新节点与分支。 */
function mountCanvas(spec: WorkflowSpec, editable = true) {
  let latest = spec;
  const changed: WorkflowSpec[] = [];
  const edited: { node: WorkflowNode; branchIndex: number | null }[] = [];
  let applicantEdits = 0;
  let connectionViews = 0;
  function Harness() {
    const [value, setValue] = useState(spec);
    return (
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <WorkflowCanvas
            spec={value}
            editable={editable}
            personOptions={[{ value: 11, label: "王主管" }]}
            onChange={(next) => {
              latest = next;
              changed.push(next);
              setValue(next);
            }}
            onEditNode={(node, branchIndex) =>
              edited.push({ node, branchIndex })
            }
            onEditApplicant={() => applicantEdits++}
            onViewConnections={() => connectionViews++}
          />
        </App>
      </ConfigProvider>
    );
  }
  const view = render(<Harness />);
  return {
    ...view,
    changed,
    edited,
    get latest() {
      return latest;
    },
    get applicantEdits() {
      return applicantEdits;
    },
    get connectionViews() {
      return connectionViews;
    },
  };
}

/** 默认和两个条件均指向同一审批节点，最能识别只按目标 ID 改线的错误。 */
function branchedSpec(): WorkflowSpec {
  const spec = initialSpec();
  spec.nodes.unshift({
    id: "choice",
    name: "金额分流",
    type: "CONDITION",
    next: "review",
    conditions: [
      { field: "amount", operator: "GT", value: "1000", next: "review" },
      { field: "amount", operator: "GT", value: "100", next: "review" },
    ],
  });
  spec.fields.push({ id: "amount", label: "金额", type: "MONEY" });
  spec.startNodeId = "choice";
  return spec;
}

async function chooseInsert(label: string, type = "审批人") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: label, exact: true }));
  await user.click(
    await screen.findByRole("button", { name: type, exact: true }),
  );
}

test("发起人线路加号选择审批人即自动接续，并打开该新增节点业务设置", async () => {
  const source = initialSpec();
  const before = structuredClone(source);
  const canvas = mountCanvas(source);
  await chooseInsert("在发起人后添加节点");
  assert.equal(canvas.changed.length, 1);
  const added = canvas.latest.nodes.find(
    (node) => node.id === canvas.latest.startNodeId,
  )!;
  assert.equal(added.type, "APPROVAL");
  assert.equal(added.next, "review");
  assert.deepEqual(canvas.edited, [{ node: added, branchIndex: null }]);
  assert.deepEqual(source, before, "插入不能直接修改传入快照");
  assert.equal(
    screen.queryByText("1 个旧节点尚未接入流程，发布前需处理"),
    null,
  );
});

test("真实画布插入并行组展示支路及汇合，添加支路生成审批节点", async () => {
  const canvas = mountCanvas(initialSpec());
  await chooseInsert("在发起人后添加节点", "并行分支");
  const fork = canvas.latest.nodes.find((node) => node.type === "PARALLEL")!;
  assert.equal(fork.branches?.length, 2);
  assert.ok(screen.getByText(/全部支路完成/));
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "添加支路", exact: true }),
  );
  assert.equal(
    canvas.latest.nodes.find((node) => node.id === fork.id)?.branches?.length,
    3,
  );
  const branch = canvas.latest.nodes.find(
    (node) =>
      node.id ===
      canvas.latest.nodes.find((node) => node.id === fork.id)?.branches?.[2],
  );
  assert.equal(branch?.type, "APPROVAL");
  assert.equal(branch?.next, fork.next);
});

test("真实并行支路线路可插入子流程，只改变当前支路入口", async () => {
  const canvas = mountCanvas(initialSpec());
  await chooseInsert("在发起人后添加节点", "并行分支");
  const fork = canvas.latest.nodes.find((node) => node.type === "PARALLEL")!;
  const previous = structuredClone(fork.branches!);
  await chooseInsert(`在“${fork.name}”支路1中添加节点`, "子流程");
  const child = canvas.latest.nodes.find((node) => node.type === "SUBPROCESS")!;
  const updated = canvas.latest.nodes.find((node) => node.id === fork.id)!;
  assert.equal(updated.branches?.[0], child.id);
  assert.equal(updated.branches?.[1], previous[1]);
  assert.equal(child.next, previous[0]);
  assert.equal(canvas.edited.at(-1)?.node.id, child.id);
});

test("条件线路加号只插入选中的确切规则，不改变同目标的默认与其他规则", async () => {
  const canvas = mountCanvas(branchedSpec());
  await chooseInsert("在“金额分流”条件2中添加节点", "抄送人");
  const condition = canvas.latest.nodes.find((node) => node.id === "choice")!;
  const added = canvas.latest.nodes.find((node) => node.type === "COPY")!;
  assert.equal(added.next, "review");
  assert.equal(condition.conditions![1].next, added.id);
  assert.equal(condition.conditions![0].next, "review");
  assert.equal(condition.next, "review");
  assert.equal(canvas.edited.at(-1)!.node.id, added.id);
});

test("默认分支加号与分支汇合后加号分别修改局部出口和共享后续", async () => {
  const canvas = mountCanvas(branchedSpec());
  await chooseInsert("在“金额分流”默认分支中添加节点", "抄送人");
  let condition = canvas.latest.nodes.find((node) => node.id === "choice")!;
  const defaultCopy = canvas.latest.nodes.find((node) => node.type === "COPY")!;
  assert.equal(condition.next, defaultCopy.id);
  assert.ok(condition.conditions!.every((rule) => rule.next === "review"));
  await chooseInsert("在“金额分流”分支汇合后添加节点");
  condition = canvas.latest.nodes.find((node) => node.id === "choice")!;
  const shared = canvas.latest.nodes.find((node) => node.id === "approval_1")!;
  const copy = canvas.latest.nodes.find((node) => node.id === defaultCopy.id)!;
  assert.equal(shared.next, "review");
  assert.equal(copy.next, shared.id);
  assert.equal(condition.next, defaultCopy.id);
  assert.ok(condition.conditions!.every((rule) => rule.next === shared.id));
  assert.equal(
    screen.getAllByRole("button", { name: "设置审批：审批人", exact: true })
      .length,
    1,
  );
});

test("业务节点卡片及条件卡片点击传递节点和规则序号，不改图结构", async () => {
  const spec = branchedSpec();
  spec.nodes.find((node) => node.id === "review")!.assigneeIds = [11];
  const canvas = mountCanvas(spec);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "设置审批：审批", exact: true }),
  );
  await user.click(screen.getByRole("button", { name: /金额 大于 1000/ }));
  assert.equal(canvas.edited[0].node.id, "review");
  assert.equal(canvas.edited[0].branchIndex, null);
  assert.equal(canvas.edited[1].node.id, "choice");
  assert.equal(canvas.edited[1].branchIndex, 0);
  assert.equal(canvas.changed.length, 0);
  await user.click(screen.getByRole("button", { name: /^发起人\s*所有人$/ }));
  assert.equal(canvas.applicantEdits, 1);
});

test("删除节点先确认；取消不改模型，确认自动恢复前后接续", async () => {
  const canvas = mountCanvas(initialSpec());
  await chooseInsert("在发起人后添加节点", "抄送人");
  const copy = canvas.latest.nodes.find((node) => node.type === "COPY")!;
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "删除节点：抄送人", exact: true }),
  );
  let dialog = await screen.findByRole("dialog");
  assert.equal(canvas.latest.startNodeId, copy.id);
  await user.click(
    within(dialog).getByRole("button", { name: /^(Cancel|取\s*消)$/ }),
  );
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.equal(canvas.latest.startNodeId, copy.id);
  await user.click(
    screen.getByRole("button", { name: "删除节点：抄送人", exact: true }),
  );
  dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^删\s*除$/ }));
  await waitFor(() => assert.equal(canvas.latest.startNodeId, "review"));
  assert.equal(
    canvas.latest.nodes.some((node) => node.id === copy.id),
    false,
  );
});

test("删除条件组保留默认路线与公共审批，清理条件独有抄送节点", async () => {
  const canvas = mountCanvas(branchedSpec());
  await chooseInsert("在“金额分流”条件1中添加节点", "抄送人");
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "删除分支组：金额分流", exact: true }),
  );
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^删\s*除$/ }));
  await waitFor(() => assert.equal(canvas.latest.startNodeId, "review"));
  assert.deepEqual(
    canvas.latest.nodes.map((node) => node.id),
    ["review", "end"],
  );
});

test("只读画布禁止所有业务修改，包括旧孤立节点入口，但保留缩放浏览", async () => {
  const spec = branchedSpec();
  spec.nodes.push({
    ...spec.nodes.find((node) => node.id === "review")!,
    id: "orphan",
    name: "旧孤立审批",
  });
  const canvas = mountCanvas(spec, false);
  const user = userEvent.setup();
  assert.equal(screen.queryByRole("button", { name: /添加节点/ }), null);
  assert.equal(
    screen.queryByRole("button", { name: /删除节点|删除分支组|添加条件/ }),
    null,
  );
  await user.click(
    screen.getByRole("button", { name: "设置审批：审批", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "旧孤立审批", exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "缩小流程", exact: true }),
  );
  assert.equal(canvas.edited.length, 0, "只读账号不能经孤立节点入口打开编辑器");
  assert.equal(canvas.changed.length, 0);
  assert.ok(
    screen
      .getByRole("button", { name: "恢复流程原始大小", exact: true })
      .textContent?.includes("90%"),
  );
});

test("合法的独立结束分支保持原路径，不虚构汇合连线或偷偷规范化旧模型", () => {
  const spec = branchedSpec();
  const condition = spec.nodes.find((node) => node.id === "choice")!;
  condition.conditions = [
    { field: "amount", operator: "GT", value: "1000", next: "branchReview" },
  ];
  spec.nodes.push(
    {
      ...spec.nodes.find((node) => node.id === "review")!,
      id: "branchReview",
      name: "分支审批",
      next: "branchEnd",
    },
    { id: "branchEnd", name: "独立结束", type: "END" },
  );
  const before = structuredClone(spec);
  const canvas = mountCanvas(spec);
  assert.equal(screen.getAllByText("流程结束").length, 2);
  assert.equal(
    screen.queryByRole("button", {
      name: "在“金额分流”分支汇合后添加节点",
      exact: true,
    }),
    null,
  );
  assert.equal(
    canvas.container.querySelectorAll(".oa-branch-rail.bottom, .oa-branch-tail")
      .length,
    0,
  );
  assert.equal(canvas.changed.length, 0);
  assert.deepEqual(spec, before);
});

test("旧结束节点遗留的出口属性不参与运行或阻止在有效线路上自动插入", async () => {
  const spec = initialSpec();
  spec.nodes.find((node) => node.id === "end")!.next = "旧已移除节点";
  const canvas = mountCanvas(spec);
  await chooseInsert("在发起人后添加节点", "抄送人");
  assert.equal(
    canvas.changed.length,
    1,
    "后端忽略结束节点出口，设计器应保持相同解释",
  );
  assert.equal(
    canvas.latest.nodes.find((node) => node.id === canvas.latest.startNodeId)!
      .type,
    "COPY",
  );
});

test("旧孤立结束节点可经确认清理，正在被流程引用的结束节点继续保留", async () => {
  const spec = initialSpec();
  spec.nodes.push({ id: "orphanEnd", name: "旧孤立结束", type: "END" });
  const canvas = mountCanvas(spec);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^删\s*除$/ }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^删\s*除$/ }));
  await waitFor(() =>
    assert.equal(
      canvas.latest.nodes.some((node) => node.id === "orphanEnd"),
      false,
    ),
  );
  assert.equal(
    canvas.latest.nodes.find((node) => node.id === "review")!.next,
    "end",
  );
  assert.ok(canvas.latest.nodes.some((node) => node.id === "end"));
  assert.equal(
    screen.queryByRole("button", { name: "删除节点：结束", exact: true }),
    null,
  );
});

test("复杂合法旧 DAG 展开有界，折叠不会误报孤立节点或更改原始模型", async () => {
  const spec = initialSpec();
  spec.fields.push({ id: "amount", label: "金额", type: "MONEY" });
  spec.nodes.find((node) => node.id === "review")!.next = "choice0";
  // 六层各有三条重复指向下一层的独立条件和一个提前结束出口。
  // 这是合法无环图，却有 3^6 条深层组合路径，不能把所有路径无限展开到 DOM。
  for (let level = 0; level < 6; level++) {
    const next = level < 5 ? `choice${level + 1}` : "finalReview";
    spec.nodes.push(
      {
        id: `choice${level}`,
        name: `旧条件${level + 1}`,
        type: "CONDITION",
        next: `earlyEnd${level}`,
        conditions: [0, 1, 2].map((priority) => ({
          field: "amount",
          operator: "GT",
          value: String(1000 - priority * 100),
          next,
        })),
      },
      { id: `earlyEnd${level}`, name: `提前结束${level}`, type: "END" },
    );
  }
  spec.nodes.push({
    ...spec.nodes.find((node) => node.id === "review")!,
    id: "finalReview",
    name: "末级审批",
    next: "end",
  });
  const before = structuredClone(spec);
  const canvas = mountCanvas(spec, false);
  assert.ok(screen.getByText("这份旧流程包含较多交叉路径，部分路径已折叠"));
  const rendered = canvas.container.querySelectorAll(
    ".oa-flow-card, .oa-flow-end, .oa-condition-group",
  ).length;
  assert.ok(rendered <= 240, `旧图节点 DOM 必须有界，实际 ${rendered}`);
  assert.equal(screen.queryByText(/旧节点尚未接入流程/), null);
  assert.equal(screen.queryByText("旧草稿的连线需要修复后才能发布"), null);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "查看完整连线", exact: true }));
  assert.equal(canvas.connectionViews, 1);
  assert.equal(canvas.changed.length, 0);
  assert.equal(canvas.edited.length, 0);
  assert.deepEqual(spec, before);
});

test("线路加号支持键盘打开、聚焦选项和 Escape 返回原线路，Enter 可完成插入", async () => {
  const canvas = mountCanvas(initialSpec());
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", {
    name: "在发起人后添加节点",
    exact: true,
  });
  trigger.focus();
  await user.keyboard("{Enter}");
  const approval = await screen.findByRole("button", {
    name: "审批人",
    exact: true,
  });
  await waitFor(() => assert.equal(document.activeElement, approval));
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  await user.keyboard("{Escape}");
  await waitFor(() =>
    assert.equal(trigger.getAttribute("aria-expanded"), "false"),
  );
  assert.equal(document.activeElement, trigger);
  assert.equal(canvas.changed.length, 0);
  await user.keyboard("{Enter}");
  await waitFor(() =>
    assert.equal(
      document.activeElement,
      screen.getByRole("button", { name: "审批人", exact: true }),
    ),
  );
  await user.keyboard("{Enter}");
  assert.equal(canvas.changed.length, 1);
  assert.equal(canvas.edited[0].node.type, "APPROVAL");
});
