import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { FormInstance } from "antd";
import type {
  WorkflowCondition,
  WorkflowConditionRule,
  WorkflowField,
  WorkflowNode,
} from "../src/types/workflow";

// 使用真实 Ant 控件和键盘事件覆盖十进制编辑；合成字段和条件不访问业务网络。
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
const { App, ConfigProvider, Form } = await import("antd");
const { WorkflowFields, encodeWorkflowValues, hydrateWorkflowValues } =
  await import("../src/components/WorkflowFields");
const { WorkflowFieldProperties } =
  await import("../src/components/workflow/WorkflowFieldProperties");
const { FieldEditor } = await import("../src/components/workflow/FieldEditor");
const { NodeEditor } = await import("../src/components/workflow/NodeEditor");
const { validateWorkflowFields, validateWorkflowFormValues } =
  await import("../src/lib/workflowForm");
const { conditionIssues } = await import("../src/lib/workflowConditions");

type WorkflowFormValues = { values: Record<string, unknown> };

/** 服务端回填只通过 initialValues 进入表单；编辑必须由真实输入控件产生。 */
function mountWorkflowForm(
  fields: WorkflowField[],
  initialValues: Record<string, unknown> = {},
) {
  let current: FormInstance<WorkflowFormValues>;
  function Harness() {
    const [form] = Form.useForm<WorkflowFormValues>();
    current = form;
    return (
      <Form form={form} initialValues={{ values: initialValues }}>
        <WorkflowFields fields={fields} />
      </Form>
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>,
  );
  return () => current.getFieldValue("values") as Record<string, unknown>;
}

/** 每次键入都更新父级属性，确保高精度上下限不会因重渲染丢值或失焦。 */
function mountFieldProperties(initial: WorkflowField) {
  let current = initial;
  function Harness() {
    const [field, setField] = useState(initial);
    return (
      <WorkflowFieldProperties
        field={field}
        editable
        onChange={(next) => {
          current = next;
          setField(next);
        }}
      />
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>,
  );
  return () => current;
}

function mountFieldEditor(initial: WorkflowField) {
  let saved: WorkflowField | undefined;
  function Harness() {
    const [field, setField] = useState<WorkflowField | null>(initial);
    return (
      <FieldEditor
        field={field}
        existing
        onClose={() => setField(null)}
        onSave={(next) => {
          saved = next;
          setField(null);
        }}
      />
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <Harness />
      </App>
    </ConfigProvider>,
  );
  return () => saved;
}

const conditionFields: WorkflowField[] = [
  {
    id: "kind",
    label: "申请类型",
    type: "SINGLE",
    options: ["国内差旅", "采购申请"],
  },
  { id: "quantity", label: "数量", type: "NUMBER" },
];

/** 聚焦一个条件分支，不渲染审批人员查询；保存仍经过真实 FormModal 异步校验。 */
function mountConditionNode(condition: WorkflowCondition) {
  const node: WorkflowNode = {
    id: "decimal_condition",
    name: "申请判断",
    type: "CONDITION",
    next: "end",
    conditions: [condition],
  };
  let saved: WorkflowNode | undefined;
  function Harness() {
    const [editing, setEditing] = useState<WorkflowNode | null>(node);
    return (
      <NodeEditor
        node={editing}
        existing
        structured
        branchIndex={0}
        nodes={[node, { id: "end", name: "结束", type: "END" }]}
        fields={conditionFields}
        onClose={() => setEditing(null)}
        onSave={(next) => {
          saved = next;
          setEditing(null);
        }}
      />
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <App>
        <Harness />
      </App>
    </ConfigProvider>,
  );
  return () => saved;
}

async function replaceInput(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  value: string,
) {
  await user.clear(input);
  await user.type(input, value);
  assert.equal(document.activeElement, input);
  await user.tab();
  assert.equal((input as HTMLInputElement).value, value);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
after(() => {
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

test("正常输入合法大额金额、六位小数数字和明细金额，失焦和提交编码保留精确字符串", async () => {
  const user = userEvent.setup();
  const fields: WorkflowField[] = [
    { id: "amount", label: "申请金额", type: "MONEY" },
    { id: "quantity", label: "数量", type: "NUMBER" },
    {
      id: "expenses",
      label: "费用明细",
      type: "DETAILS",
      columns: [{ id: "amount", label: "明细金额", type: "MONEY" }],
    },
  ];
  const values = mountWorkflowForm(fields);
  await replaceInput(
    user,
    screen.getByLabelText("申请金额"),
    "999999999999999.99",
  );
  await replaceInput(
    user,
    screen.getByLabelText("数量"),
    "999999999999.123456",
  );
  await user.click(screen.getByRole("button", { name: "添加明细 (0/20)" }));
  await replaceInput(
    user,
    screen.getByLabelText("第1行明细金额"),
    "999999999999999.99",
  );
  const expected = {
    amount: "999999999999999.99",
    quantity: "999999999999.123456",
    expenses: [{ amount: "999999999999999.99" }],
  };
  assert.deepEqual(values(), expected);
  assert.deepEqual(encodeWorkflowValues(fields, values()), expected);
  assert.deepEqual(validateWorkflowFields(fields), []);
  assert.deepEqual(validateWorkflowFormValues(fields, values()), []);
});

test("指数数字回填后聚焦失焦且未修改，表单和提交编码保留原指数表示", async () => {
  const user = userEvent.setup();
  const fields: WorkflowField[] = [
    { id: "exponent", label: "指数数字", type: "NUMBER", required: true },
  ];
  const original = { exponent: "1E+3" };
  const hydrated = hydrateWorkflowValues(fields, original, []);
  assert.deepEqual(hydrated, original);
  const values = mountWorkflowForm(fields, hydrated);
  assert.deepEqual(values(), original);
  const input = screen.getByLabelText("指数数字") as HTMLInputElement;
  await user.click(input);
  assert.equal(document.activeElement, input);
  await user.tab();
  assert.notEqual(document.activeElement, input);
  // Ant 可以展开显示为 1000；未编辑时必须保留受控值，避免文本包含条件改变含义。
  assert.deepEqual(values(), original);
  const encoded = encodeWorkflowValues(fields, values());
  assert.deepEqual(encoded, original);
  assert.equal(String(encoded.exponent).includes("000"), false);
  assert.deepEqual(validateWorkflowFormValues(fields, values()), []);
  assert.deepEqual(original, { exponent: "1E+3" });
});

const returnedFields: WorkflowField[] = [
  { id: "amount", label: "退回申请金额", type: "MONEY" },
  { id: "quantity", label: "退回数量", type: "NUMBER" },
  { id: "fee", label: "金额增量", type: "MONEY" },
  { id: "increment", label: "数量增量", type: "NUMBER" },
  {
    id: "expenses",
    label: "退回费用明细",
    type: "DETAILS",
    columns: [{ id: "amount", label: "明细金额", type: "MONEY" }],
  },
  {
    id: "amount_total",
    label: "重算金额",
    type: "CALCULATED",
    formula: { operation: "SUM", operands: ["amount", "fee"], scale: 2 },
  },
  {
    id: "quantity_total",
    label: "重算数量",
    type: "CALCULATED",
    formula: {
      operation: "SUM",
      operands: ["quantity", "increment"],
      scale: 6,
    },
  },
  {
    id: "detail_total",
    label: "明细合计",
    type: "CALCULATED",
    formula: {
      operation: "DETAIL_SUM",
      operands: ["expenses"],
      column: "amount",
      scale: 2,
    },
  },
];

for (const sample of [
  {
    name: "服务端十进制字符串",
    values: {
      amount: "999999999999999.97",
      quantity: "999999999999.123454",
      fee: "0.01",
      increment: "0.000001",
      expenses: [{ amount: "999999999999999.97" }],
    },
    initialTotals: [
      "999999999999999.98",
      "999999999999.123455",
      "999999999999999.97",
    ],
    initialInputs: [
      "999999999999999.97",
      "999999999999.123454",
      "999999999999999.97",
    ],
    finalDigits: ["8", "5", "9"],
    finalValues: [
      "999999999999999.98",
      "999999999999.123455",
      "999999999999999.99",
    ],
    finalTotals: [
      "999999999999999.99",
      "999999999999.123456",
      "999999999999999.99",
    ],
  },
  {
    name: "旧申请 JSON number",
    values: {
      amount: 0.1,
      quantity: 0.2,
      fee: 0.01,
      increment: 0.000001,
      expenses: [{ amount: 0.1 }],
    },
    initialTotals: ["0.11", "0.200001", "0.10"],
    // 金额控件按既有两位精度展示旧 number；正常键盘修改最后一位即分位。
    initialInputs: ["0.10", "0.2", "0.10"],
    finalDigits: ["3", "4", "7"],
    finalValues: ["0.13", "0.4", "0.17"],
    finalTotals: ["0.14", "0.400001", "0.17"],
  },
])
  test(`${sample.name}回填后退回修改，主字段和明细逐键编辑即时精确重算`, async () => {
    const user = userEvent.setup();
    const original = structuredClone(sample.values);
    const hydrated = hydrateWorkflowValues(returnedFields, sample.values, []);
    assert.deepEqual(hydrated, original);
    const values = mountWorkflowForm(returnedFields, hydrated);
    const inputLabels = ["退回申请金额", "退回数量", "第1行明细金额"];
    const totalLabels = ["重算金额", "重算数量", "明细合计"];
    for (const [index, label] of totalLabels.entries()) {
      const total = screen.getByLabelText(label) as HTMLInputElement;
      assert.equal(total.readOnly, true);
      await waitFor(() =>
        assert.equal(total.value, sample.initialTotals[index]),
      );
    }
    assert.equal(
      (screen.getByLabelText(inputLabels[0]) as HTMLInputElement).value,
      sample.initialInputs[0],
    );
    assert.equal(
      (screen.getByLabelText(inputLabels[1]) as HTMLInputElement).value,
      sample.initialInputs[1],
    );
    assert.equal(
      (screen.getByLabelText(inputLabels[2]) as HTMLInputElement).value,
      sample.initialInputs[2],
    );
    for (const [index, label] of inputLabels.entries()) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      await user.click(input);
      await user.keyboard(`{End}{Backspace}${sample.finalDigits[index]}`);
      assert.equal(document.activeElement, input);
      assert.equal(input.value, sample.finalValues[index]);
      // 在失焦之前确认重算，防止回填后只有提交时才恢复计算。
      await waitFor(() =>
        assert.equal(
          (screen.getByLabelText(totalLabels[index]) as HTMLInputElement).value,
          sample.finalTotals[index],
        ),
      );
      await user.tab();
      assert.equal(input.value, sample.finalValues[index]);
    }
    assert.deepEqual(encodeWorkflowValues(returnedFields, values()), {
      amount: sample.finalValues[0],
      quantity: sample.finalValues[1],
      fee: sample.values.fee,
      increment: sample.values.increment,
      expenses: [{ amount: sample.finalValues[2] }],
    });
    assert.deepEqual(validateWorkflowFormValues(returnedFields, values()), []);
    assert.deepEqual(sample.values, original);
  });

test("主字段与明细列上下限逐键保留高精度邻居，逆序提示与发布校验同步恢复", async () => {
  const user = userEvent.setup();
  for (const sample of [
    {
      type: "MONEY" as const,
      minimum: "999999999999999.97",
      maximum: "999999999999999.98",
      invalid: "999999999999999.99",
    },
    {
      type: "NUMBER" as const,
      minimum: "999999999999.123454",
      maximum: "999999999999.123455",
      invalid: "999999999999.123456",
    },
  ])
    for (const detail of [false, true]) {
      const numeric: WorkflowField = {
        id: "amount",
        label: "金额或数量",
        type: sample.type,
        min: 0,
        max: 1,
      };
      const field: WorkflowField = detail
        ? {
            id: "expenses",
            label: "费用明细",
            type: "DETAILS",
            columns: [numeric],
          }
        : numeric;
      const current = mountFieldProperties(field);
      const panel = detail
        ? screen.getByRole("region", { name: "当前明细列属性" })
        : screen.getByRole("region", { name: "字段属性" });
      const minimum = within(panel).getByLabelText("最小值");
      const maximum = within(panel).getByLabelText("最大值");
      await replaceInput(user, maximum, sample.maximum);
      await replaceInput(user, minimum, sample.minimum);
      const configured = () => (detail ? current().columns![0] : current());
      assert.equal(configured().min, sample.minimum);
      assert.equal(configured().max, sample.maximum);
      assert.equal(screen.queryByRole("alert"), null);
      assert.deepEqual(validateWorkflowFields([current()]), []);
      await replaceInput(user, minimum, sample.invalid);
      assert.equal(configured().min, sample.invalid);
      assert.match(
        screen.getByRole("alert").textContent!,
        /最小值不能大于最大值/,
      );
      assert.ok(
        validateWorkflowFields([current()]).some((issue) =>
          /下限不能大于上限/.test(issue.message),
        ),
      );
      await replaceInput(user, minimum, sample.minimum);
      assert.equal(screen.queryByRole("alert"), null);
      assert.deepEqual(validateWorkflowFields([current()]), []);
      const formValues = (value: string) =>
        detail ? { expenses: [{ amount: value }] } : { amount: value };
      assert.deepEqual(
        validateWorkflowFormValues([current()], formValues(sample.minimum)),
        [],
      );
      assert.deepEqual(
        validateWorkflowFormValues([current()], formValues(sample.maximum)),
        [],
      );
      assert.ok(
        validateWorkflowFormValues(
          [current()],
          formValues(sample.invalid),
        ).some((issue) => /允许范围/.test(issue.message)),
      );
      cleanup();
    }
});

test("十进制字符串输入不放宽金额两位、数字六位、十八位精度与绝对值上限", () => {
  for (const sample of [
    {
      type: "MONEY" as const,
      valid: "999999999999999.99",
      invalid: [
        "1.001",
        "0.0100",
        "1000000000000000.01",
        "1000000000000000000e-3",
      ],
    },
    {
      type: "NUMBER" as const,
      valid: "999999999999.123456",
      invalid: [
        "1.0000001",
        "9999999999999.123456",
        "1000000000000000.000001",
        "1000000000000000000e-6",
      ],
    },
  ]) {
    const numeric: WorkflowField = {
      id: "amount",
      label: "数值",
      type: sample.type,
    };
    const details: WorkflowField = {
      id: "expenses",
      label: "明细",
      type: "DETAILS",
      columns: [numeric],
    };
    for (const field of [numeric, details]) {
      assert.deepEqual(validateWorkflowFields([field]), []);
      const values = (value: string) =>
        field.type === "DETAILS"
          ? { expenses: [{ amount: value }] }
          : { amount: value };
      assert.deepEqual(
        validateWorkflowFormValues([field], values(sample.valid)),
        [],
      );
      for (const invalid of sample.invalid)
        assert.ok(
          validateWorkflowFormValues([field], values(invalid)).some((issue) =>
            /精度或大小超出范围/.test(issue.message),
          ),
          invalid,
        );
    }
  }
});

test("旧字段弹窗的主字段与明细列上下限经真实键盘输入和异步保存保留字符串", async () => {
  const user = userEvent.setup();
  for (const detail of [false, true]) {
    const numeric: WorkflowField = {
      id: "amount",
      label: "精确金额",
      type: "MONEY",
      width: 24,
      min: 0,
      max: 1,
    };
    const field: WorkflowField = detail
      ? {
          id: "expenses",
          label: "费用明细",
          type: "DETAILS",
          width: 24,
          columns: [numeric],
        }
      : numeric;
    const saved = mountFieldEditor(field);
    const dialog = await screen.findByRole("dialog", { name: "编辑表单字段" });
    if (detail)
      await user.click(
        within(dialog).getByRole("tab", { name: "明细列", exact: true }),
      );
    await replaceInput(
      user,
      within(dialog).getByLabelText("最小值"),
      "999999999999999.98",
    );
    await replaceInput(
      user,
      within(dialog).getByLabelText("最大值"),
      "999999999999999.99",
    );
    await user.click(within(dialog).getByRole("button", { name: "保 存" }));
    await waitFor(() => assert.ok(saved()));
    const numericResult = detail ? saved()!.columns![0] : saved()!;
    assert.equal(numericResult.min, "999999999999999.98");
    assert.equal(numericResult.max, "999999999999999.99");
    assert.equal(numericResult.id, numeric.id);
    assert.deepEqual(validateWorkflowFields([saved()!]), []);
    cleanup();
  }
});

test("旧单条件的单选包含使用自由输入保存任意子串，保留分支出口", async () => {
  const user = userEvent.setup();
  const saved = mountConditionNode({
    field: "kind",
    operator: "CONTAINS",
    value: "国内",
    next: "review_travel",
  });
  const dialog = await screen.findByRole("dialog", { name: "条件1设置" });
  const input = within(dialog).getByLabelText("比较值");
  assert.equal(input.getAttribute("role"), null);
  assert.equal(input.tagName, "INPUT");
  await replaceInput(user, input, "差旅");
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert.ok(saved()));
  assert.deepEqual(saved()!.conditions![0], {
    field: "kind",
    operator: "CONTAINS",
    value: "差旅",
    next: "review_travel",
  });
  assert.deepEqual(
    conditionIssues(saved()!.conditions![0], conditionFields),
    [],
  );
});

for (const operator of ["EQ", "NE"] as const)
  test(`旧单条件 ${operator} 保留固定选项，下拉回填的失效选项不能保存且可重新选择恢复`, async () => {
    const user = userEvent.setup();
    const saved = mountConditionNode({
      field: "kind",
      operator,
      value: "失效旧选项",
      next: "review_kind",
    });
    const dialog = await screen.findByRole("dialog", { name: "条件1设置" });
    const value = within(dialog).getByLabelText("比较值");
    assert.equal(value.getAttribute("role"), "combobox");
    await user.click(within(dialog).getByRole("button", { name: "保 存" }));
    await within(dialog).findByText("请选择此字段的已有选项。");
    assert.equal(saved(), undefined);
    assert.ok(screen.getByRole("dialog", { name: "条件1设置" }));
    await user.click(value);
    await screen.findByTitle("国内差旅");
    await screen.findByTitle("采购申请");
    assert.equal(screen.queryByTitle("差旅"), null);
    await user.click(screen.getByTitle("国内差旅"));
    await user.tab();
    await user.click(within(dialog).getByRole("button", { name: "保 存" }));
    await waitFor(() => assert.ok(saved()));
    assert.deepEqual(saved()!.conditions![0], {
      field: "kind",
      operator,
      value: "国内差旅",
      next: "review_kind",
    });
  });

for (const logic of ["AND", "OR"] as const)
  test(`组合条件 ${logic} 的单选包含逐字输入保存，嵌套关系、固定选项与精确数字保持`, async () => {
    const user = userEvent.setup();
    const predicate: WorkflowConditionRule = {
      logic,
      children: [
        { field: "kind", operator: "CONTAINS", value: "国内" },
        {
          logic: logic === "AND" ? "OR" : "AND",
          children: [
            { field: "kind", operator: "CONTAINS", value: "采购" },
            { field: "kind", operator: "EQ", value: "国内差旅" },
            { field: "kind", operator: "NE", value: "采购申请" },
          ],
        },
        { field: "quantity", operator: "GE", value: "1" },
      ],
    };
    const saved = mountConditionNode({ next: "review_group", predicate });
    const dialog = await screen.findByRole("dialog", { name: "条件1设置" });
    const contains = within(dialog).getByLabelText("判断1.1值");
    const nestedContains = within(dialog).getByLabelText("判断1.2.1值");
    assert.equal(contains.getAttribute("role"), null);
    assert.equal(nestedContains.getAttribute("role"), null);
    await replaceInput(user, contains, "差旅");
    await replaceInput(user, nestedContains, "购申");
    for (const path of ["1.2.2", "1.2.3"])
      assert.equal(
        within(dialog).getByLabelText(`判断${path}值`).getAttribute("role"),
        "combobox",
      );
    await replaceInput(
      user,
      within(dialog).getByLabelText("判断1.3值"),
      "999999999999.123456",
    );
    await user.click(within(dialog).getByRole("button", { name: "保 存" }));
    await waitFor(() => assert.ok(saved()));
    const expected: WorkflowConditionRule = {
      ...predicate,
      children: [
        { field: "kind", operator: "CONTAINS", value: "差旅" },
        {
          ...predicate.children![1],
          children: [
            { field: "kind", operator: "CONTAINS", value: "购申" },
            { field: "kind", operator: "EQ", value: "国内差旅" },
            { field: "kind", operator: "NE", value: "采购申请" },
          ],
        },
        { field: "quantity", operator: "GE", value: "999999999999.123456" },
      ],
    };
    assert.deepEqual(saved()!.conditions![0], {
      next: "review_group",
      predicate: expected,
    });
    assert.deepEqual(
      conditionIssues(saved()!.conditions![0], conditionFields),
      [],
    );
  });

test("组合条件 EQ 与 NE 的失效值均阻止保存，两个固定下拉重新选择后校验恢复", async () => {
  const user = userEvent.setup();
  const saved = mountConditionNode({
    next: "review_options",
    predicate: {
      logic: "AND",
      children: [
        { field: "kind", operator: "EQ", value: "失效等于值" },
        { field: "kind", operator: "NE", value: "失效不等于值" },
      ],
    },
  });
  const dialog = await screen.findByRole("dialog", { name: "条件1设置" });
  const equals = within(dialog).getByLabelText("判断1.1值");
  const differs = within(dialog).getByLabelText("判断1.2值");
  assert.equal(equals.getAttribute("role"), "combobox");
  assert.equal(differs.getAttribute("role"), "combobox");
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await within(dialog).findByText(/第 1 条判断：.*选项已不存在/);
  assert.equal(saved(), undefined);
  await user.click(equals);
  await user.click(await screen.findByTitle("国内差旅"));
  await user.tab();
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await within(dialog).findByText(/第 2 条判断：.*选项已不存在/);
  assert.equal(saved(), undefined);
  await user.click(differs);
  // Ant 保留已关闭下拉的 DOM，限定当前可见弹层，确保点击实际用户看到的选项。
  const dropdown = document.querySelector(
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  );
  assert.ok(dropdown);
  await user.click(within(dropdown as HTMLElement).getByTitle("采购申请"));
  await user.tab();
  await user.click(within(dialog).getByRole("button", { name: "保 存" }));
  await waitFor(() => assert.ok(saved()));
  assert.deepEqual(saved()!.conditions![0], {
    next: "review_options",
    predicate: {
      logic: "AND",
      children: [
        { field: "kind", operator: "EQ", value: "国内差旅" },
        { field: "kind", operator: "NE", value: "采购申请" },
      ],
    },
  });
});
