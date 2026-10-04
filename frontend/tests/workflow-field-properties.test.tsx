import { JSDOM } from "jsdom";
import test, { after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { WorkflowField } from "../src/types/workflow";

// 使用真实 Ant 输入控件验证连续编辑和选择项编排；合成字段不访问业务网络。
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
const { render, screen, within, cleanup, fireEvent } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { ConfigProvider, Form } = await import("antd");
const { WorkflowFieldProperties } =
  await import("../src/components/workflow/WorkflowFieldProperties");
const { WorkflowFields, encodeWorkflowValues } =
  await import("../src/components/WorkflowFields");
const { ConditionGroupEditor } =
  await import("../src/components/workflow/ConditionGroupEditor");

/** 父级每次回调立即重渲染，贴近真实设计器，能发现按输入值重建组件造成的失焦。 */
function mountField(
  initial: WorkflowField | null,
  editable = true,
  fields: WorkflowField[] = [],
) {
  const changes: WorkflowField[] = [];
  function Harness() {
    const [field, setField] = useState(initial);
    return (
      <WorkflowFieldProperties
        fields={fields}
        field={field}
        editable={editable}
        onChange={(value) => {
          changes.push(value);
          setField(value);
        }}
      />
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>,
  );
  return changes;
}

afterEach(cleanup);
after(() => {
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
});

test("标题实时编辑保持输入焦点，保留标识、类型与旧扩展属性，空标题即时提示", async () => {
  const user = userEvent.setup();
  const initial = {
    id: "old_description",
    label: "申请说明",
    type: "TEXTAREA" as const,
    maxLength: 2000,
    extension: { legacy: "保留" },
  };
  const changes = mountField(initial);
  assert.equal(screen.queryByLabelText("字段 ID"), null);
  assert.equal(screen.queryByLabelText("控件类型"), null);
  assert.equal(screen.queryByRole("button", { name: /保存/ }), null);
  const title = screen.getByLabelText("字段标题");
  await user.clear(title);
  assert.match(screen.getByText("标题不能为空").textContent, /不能为空/);
  await user.type(title, "详细申请说明");
  assert.equal(document.activeElement, title);
  assert.equal(screen.getByLabelText("字段标题"), title);
  const latest = changes.at(-1);
  assert.equal(latest.label, "详细申请说明");
  assert.equal(latest.id, "old_description");
  assert.equal(latest.type, "TEXTAREA");
  assert.deepEqual(latest.extension, initial.extension);
  assert.equal(latest.maxLength, 2000);
  assert.equal(initial.label, "申请说明");
  await user.click(screen.getByLabelText("字段必填"));
  assert.equal(changes.at(-1).required, true);
  await user.click(screen.getByText("半行", { exact: true }));
  assert.equal(changes.at(-1).width, 12);
});

test("桌面属性与关闭后保留的弹窗同时存在时，字段、明细列及行数标签使用实例唯一稳定 ID", async () => {
  const user = userEvent.setup();
  const initial: WorkflowField = {
    id: "shared_details",
    label: "同一表单字段",
    type: "DETAILS",
    maxRows: 20,
    columns: [
      { id: "item", label: "项目", type: "TEXT", maxLength: 100 },
      { id: "amount", label: "金额", type: "MONEY", min: 0, max: 200 },
    ],
  };
  const changes: WorkflowField[] = [];
  function Harness() {
    const [field, setField] = useState(initial);
    const onChange = (value: WorkflowField) => {
      changes.push(value);
      setField(value);
    };
    return (
      <>
        <section data-testid="desktop-properties">
          <WorkflowFieldProperties field={field} editable onChange={onChange} />
        </section>
        <section data-testid="retained-modal-properties" hidden>
          <WorkflowFieldProperties field={field} editable onChange={onChange} />
        </section>
      </>
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>,
  );
  const desktop = screen.getByTestId("desktop-properties");
  const retained = screen.getByTestId("retained-modal-properties");

  function assertLabelTargets() {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input[id^="workflow-property-"], textarea[id^="workflow-property-"], input[id^="workflow-detail-rows-"]',
      ),
    );
    assert.ok(inputs.length >= 14);
    assert.equal(new Set(inputs.map((input) => input.id)).size, inputs.length);
    for (const input of inputs) assert.equal(input.labels.length, 1);
    for (const panel of [desktop, retained])
      for (const label of panel.querySelectorAll<HTMLLabelElement>(
        "label[for]",
      )) {
        const target = document.getElementById(label.htmlFor);
        assert.ok(target);
        assert.ok(panel.contains(target));
      }
  }

  assertLabelTargets();
  const title = within(desktop).getByRole("textbox", {
    name: "字段标题",
    exact: true,
  }) as HTMLInputElement;
  const titleId = title.id;
  await user.click(title.labels[0]);
  assert.equal(document.activeElement, title);
  await user.type(title, "（修改）");
  assert.equal(document.activeElement, title);
  assert.equal(title.id, titleId);
  assertLabelTargets();
  assert.equal(changes.at(-1).id, "shared_details");
  assert.equal(changes.at(-1).label, "同一表单字段（修改）");
  assert.deepEqual(changes.at(-1).columns, initial.columns);
  // 保留的旧弹窗可能显示另一列，两个实例同时渲染数值属性也必须保持独立标签关联。
  await user.click(
    within(desktop).getByRole("button", { name: "选择明细列 2" }),
  );
  fireEvent.click(retained.querySelector('button[aria-label="选择明细列 2"]'));
  assertLabelTargets();
  const minimum = within(desktop).getByRole("spinbutton", {
    name: "最小值",
    exact: true,
  }) as HTMLInputElement;
  await user.click(minimum.labels[0]);
  assert.equal(document.activeElement, minimum);
});

test("选项独立逐字编辑、排序、增删，旧值不被 trim，重复或空值保留并提示", async () => {
  const user = userEvent.setup();
  const changes = mountField({
    id: "old_options",
    label: "类型",
    type: "SINGLE",
    options: [" 差旅 ", "采购"],
  });
  const option = screen.getByLabelText("选项 1");
  assert.equal(option.value, " 差旅 ");
  await user.type(option, "服务");
  assert.equal(document.activeElement, option);
  assert.equal(screen.getByLabelText("选项 1"), option);
  assert.deepEqual(changes.at(-1).options, [" 差旅 服务", "采购"]);
  await user.click(screen.getByRole("button", { name: "下移选项 1" }));
  assert.deepEqual(changes.at(-1).options, ["采购", " 差旅 服务"]);
  assert.equal(screen.getByLabelText("选项 2"), option);
  const first = screen.getByLabelText("选项 1");
  await user.clear(first);
  assert.match(
    screen.getByText("第 1 项：选项不能为空").textContent,
    /不能为空/,
  );
  assert.deepEqual(changes.at(-1).options, ["", " 差旅 服务"]);
  await user.type(first, " 差旅 服务");
  assert.equal(screen.getAllByText(/选项不能重复/).length, 2);
  await user.click(screen.getByRole("button", { name: "删除选项 1" }));
  await user.click(screen.getByRole("button", { name: "添加选项" }));
  assert.deepEqual(changes.at(-1).options, [" 差旅 服务", "选项1"]);
  assert.equal(changes.at(-1).id, "old_options");
});

test("数字范围和文本长度的临时无效值显示提示，清空保留其他字段属性", async () => {
  const user = userEvent.setup();
  const changes = mountField({
    id: "amount",
    label: "金额",
    type: "MONEY",
    min: 0,
    max: 100,
    helpText: "包含税费",
  });
  const min = screen.getByLabelText("最小值");
  await user.clear(min);
  await user.type(min, "200");
  assert.equal(changes.at(-1).min, 200);
  assert.equal(changes.at(-1).max, 100);
  assert.match(screen.getByRole("alert").textContent, /最小值不能大于最大值/);
  await user.clear(min);
  assert.equal(changes.at(-1).min, undefined);
  assert.equal(changes.at(-1).helpText, "包含税费");
  cleanup();
  const textChanges = mountField({
    id: "reason",
    label: "原因",
    type: "TEXT",
    maxLength: 60,
  });
  const length = screen.getByLabelText("最大长度");
  await user.clear(length);
  await user.type(length, "0");
  assert.equal(textChanges.at(-1).maxLength, 0);
  assert.match(screen.getByText(/最大长度应为/).textContent, /1 至 10000/);
});

test("Java 旧字段的 null 长度、范围及明细行上限视为缺省，修改其他属性不改写 null", async () => {
  const user = userEvent.setup();
  // Java 的 nullable 数值会显式序列化为 null；此处模拟真实响应边界，不修改契约或旧草稿。
  const cases = [
    {
      id: "legacy_text",
      label: "旧文字字段",
      type: "TEXT",
      maxLength: null,
      min: null,
      max: null,
    },
    {
      id: "legacy_amount",
      label: "仅上限的金额",
      type: "MONEY",
      min: null,
      max: -1,
    },
    {
      id: "legacy_number",
      label: "仅下限的数字",
      type: "NUMBER",
      min: 1,
      max: null,
    },
    {
      id: "legacy_details",
      label: "旧明细字段",
      type: "DETAILS",
      maxRows: null,
      columns: [
        {
          id: "item",
          label: "项目",
          type: "TEXT",
          maxLength: null,
          min: null,
          max: null,
        },
      ],
    },
  ];
  for (const original of cases) {
    const field = original as unknown as WorkflowField;
    const changes = mountField(field);
    assert.equal(screen.queryByText(/最大长度应为/), null);
    assert.equal(screen.queryByText(/最小值不能大于最大值/), null);
    assert.equal(screen.queryByText(/最多明细行应为/), null);
    assert.deepEqual(changes, []);
    await user.type(screen.getByLabelText("字段标题"), "（更新）");
    assert.deepEqual(changes.at(-1), {
      ...original,
      label: `${original.label}（更新）`,
    });
    if (field.type === "DETAILS") {
      const column = screen.getByRole("region", { name: "当前明细列属性" });
      await user.type(within(column).getByLabelText("列标题"), "名称");
      assert.equal(changes.at(-1).maxRows, null);
      assert.deepEqual(changes.at(-1).columns[0], {
        ...original.columns[0],
        label: "项目名称",
      });
    }
    cleanup();
  }
});

test("明细列选择属性、排序和删除保持稳定标识，添加列生成未占用 ID 且不能删最后列", async () => {
  const user = userEvent.setup();
  const initial: WorkflowField = {
    id: "expenses",
    label: "费用明细",
    type: "DETAILS",
    maxRows: 20,
    columns: [
      { id: "column_1", label: "费用名称", type: "TEXT", maxLength: 60 },
      { id: "column_3", label: "费用金额", type: "MONEY", min: 0 },
    ],
  };
  const changes = mountField(initial);
  await user.click(screen.getByRole("button", { name: "选择明细列 2" }));
  const properties = screen.getByRole("region", { name: "当前明细列属性" });
  const title = within(properties).getByLabelText("列标题");
  await user.clear(title);
  await user.type(title, "实付金额");
  assert.equal(document.activeElement, title);
  assert.equal(changes.at(-1).columns[1].id, "column_3");
  assert.equal(changes.at(-1).columns[1].type, "MONEY");
  assert.equal(changes.at(-1).columns[1].min, 0);
  await user.click(screen.getByRole("button", { name: "上移明细列 2" }));
  assert.deepEqual(
    changes.at(-1).columns.map(({ id }) => id),
    ["column_3", "column_1"],
  );
  assert.equal(within(properties).getByLabelText("列标题"), title);
  await user.click(screen.getByRole("button", { name: "添加列" }));
  assert.equal(changes.at(-1).columns[2].id, "column_2");
  assert.equal(changes.at(-1).columns[2].type, "TEXT");
  assert.equal(within(properties).getByLabelText("列标题").value, "明细项2");
  await user.click(screen.getByRole("button", { name: "删除明细列 3" }));
  await user.click(screen.getByRole("button", { name: "删除明细列 2" }));
  assert.equal(changes.at(-1).columns.length, 1);
  assert.equal(
    screen.getByRole("button", { name: "删除明细列 1" }).disabled,
    true,
  );
  assert.deepEqual(
    initial.columns.map(({ id }) => id),
    ["column_1", "column_3"],
  );
});

test("新增明细列只提供受支持类型，单选列独立配置选项，六列上限和行数错误可见", async () => {
  const user = userEvent.setup();
  const changes = mountField({
    id: "lines",
    label: "明细",
    type: "DETAILS",
    columns: [{ id: "column_1", label: "项目", type: "TEXT" }],
  });
  await user.click(screen.getByLabelText("新增明细列类型"));
  assert.equal(screen.queryByTitle("附件"), null);
  assert.equal(screen.queryByTitle("明细表"), null);
  await user.click(await screen.findByTitle("单选"));
  await user.click(screen.getByRole("button", { name: "添加列" }));
  assert.equal(changes.at(-1).columns[1].type, "SINGLE");
  assert.deepEqual(changes.at(-1).columns[1].options, ["选项1", "选项2"]);
  const option = screen.getByLabelText("选项 1");
  await user.clear(option);
  await user.type(option, "现金");
  assert.deepEqual(changes.at(-1).columns[1].options, ["现金", "选项2"]);
  for (let index = 2; index < 6; index++)
    await user.click(screen.getByRole("button", { name: "添加列" }));
  assert.equal(changes.at(-1).columns.length, 6);
  assert.equal(screen.getByRole("button", { name: "添加列" }).disabled, true);
  await user.type(screen.getByLabelText("最多明细行"), "51");
  assert.equal(changes.at(-1).maxRows, 51);
  assert.match(screen.getByText(/最多明细行应为/).textContent, /1 至 50/);
});

test("旧明细重复标识明确提示并拒绝列属性与编排修改，不批量覆盖、删除或重编号", async () => {
  const user = userEvent.setup();
  const initial: WorkflowField = {
    id: "legacy_lines",
    label: "旧费用明细",
    type: "DETAILS",
    columns: [
      { id: "same", label: "项目名称", type: "TEXT", maxLength: 60 },
      { id: "same", label: "项目金额", type: "MONEY", min: 0 },
    ],
  };
  const original = structuredClone(initial);
  const changes = mountField(initial);
  assert.match(screen.getByRole("alert").textContent, /明细列标识重复/);
  const properties = screen.getByRole("region", { name: "当前明细列属性" });
  assert.equal(within(properties).getByLabelText("列标题").disabled, true);
  await user.type(within(properties).getByLabelText("列标题"), "不能覆盖");
  fireEvent.change(within(properties).getByLabelText("列标题"), {
    target: { value: "强制事件不能同时改两列" },
  });
  for (const name of [
    "下移明细列 1",
    "上移明细列 2",
    "删除明细列 1",
    "删除明细列 2",
    "添加列",
  ]) {
    const button = screen.getByRole("button", { name });
    assert.equal(button.disabled, true);
    await user.click(button);
  }
  assert.deepEqual(changes, []);
  assert.deepEqual(initial, original);
  // 主字段标题与行数不依赖列标识，允许继续查看、修改，不丢旧列或改变其标识。
  await user.type(screen.getByLabelText("字段标题"), "（保留）");
  assert.deepEqual(changes.at(-1).columns, original.columns);
  assert.equal(changes.at(-1).label, "旧费用明细（保留）");
});

test("只读面板禁止字段、选项和明细列写操作，仍能选列查看属性", async () => {
  const user = userEvent.setup();
  const changes = mountField(
    {
      id: "readonly",
      label: "只读明细",
      type: "DETAILS",
      columns: [
        {
          id: "kind",
          label: "类型",
          type: "SINGLE",
          options: ["交通", "住宿"],
        },
        { id: "amount", label: "金额", type: "MONEY", min: 0 },
      ],
    },
    false,
  );
  const title = screen.getByLabelText("字段标题");
  assert.equal(title.disabled, true);
  await user.type(title, "越权");
  fireEvent.change(title, { target: { value: "强制只读写入" } });
  await user.click(screen.getByRole("button", { name: "删除选项 1" }));
  await user.click(screen.getByRole("button", { name: "下移选项 1" }));
  await user.click(screen.getByRole("button", { name: "添加选项" }));
  await user.click(screen.getByRole("button", { name: "删除明细列 1" }));
  await user.click(screen.getByRole("button", { name: "添加列" }));
  assert.deepEqual(changes, []);
  await user.click(screen.getByRole("button", { name: "选择明细列 2" }));
  const column = screen.getByRole("region", { name: "当前明细列属性" });
  assert.equal(within(column).getByLabelText("列标题").value, "金额");
  assert.equal(within(column).getByLabelText("最小值").disabled, true);
  assert.deepEqual(changes, []);
});

test("没有选中控件时仅提示选择，不显示空属性或业务操作", () => {
  const changes = mountField(null);
  assert.match(
    screen.getByText("选择表单中的控件以设置属性").textContent,
    /选择/,
  );
  assert.equal(screen.queryByLabelText("字段标题"), null);
  assert.equal(screen.queryByRole("button"), null);
  assert.deepEqual(changes, []);
});

test("计算属性用字段选择配置精度和顺序，切换方式清理不适用来源", async () => {
  const user = userEvent.setup();
  const initial: WorkflowField = {
    id: "total",
    label: "总额",
    type: "CALCULATED",
    formula: { operation: "SUM", operands: ["price"], scale: 2 },
  };
  const changes = mountField(initial, true, [
    { id: "price", label: "单价", type: "MONEY" },
    { id: "quantity", label: "数量", type: "NUMBER" },
    initial,
  ]);
  await user.click(screen.getByLabelText("计算方式"));
  await user.click(screen.getByText("相乘"));
  assert.deepEqual(changes.at(-1).formula.operands, []);
  await user.click(screen.getByLabelText("计算来源字段"));
  await user.click(screen.getByText("单价"));
  await user.click(screen.getByText("数量"));
  assert.deepEqual(changes.at(-1).formula.operands, ["price", "quantity"]);
  assert.equal(changes.at(-1).formula.scale, 2);
  assert.equal(changes.at(-1).id, "total");
});

test("填写金额即时重算只读结果，提交不发送预览结果", async () => {
  const user = userEvent.setup();
  const fields: WorkflowField[] = [
    { id: "price", label: "单价", type: "MONEY" },
    { id: "quantity", label: "数量", type: "NUMBER" },
    {
      id: "total",
      label: "总额",
      type: "CALCULATED",
      formula: {
        operation: "MULTIPLY",
        operands: ["price", "quantity"],
        scale: 2,
      },
    },
  ];
  let current;
  function Harness() {
    const [form] = Form.useForm();
    current = form;
    return (
      <Form form={form} initialValues={{ values: { price: 0.1, quantity: 3 } }}>
        <WorkflowFields fields={fields} />
      </Form>
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>,
  );
  const total = screen.getByLabelText("总额");
  assert.equal(total.readOnly, true);
  await screen.findByDisplayValue("0.30");
  const quantity = screen.getByLabelText("数量");
  await user.clear(quantity);
  await user.type(quantity, "7");
  await screen.findByDisplayValue("0.70");
  assert.deepEqual(
    encodeWorkflowValues(fields, current.getFieldValue("values")),
    { price: 0.1, quantity: 7 },
  );
});

test("组合条件真实控件支持分组、增加和删除，关系保留在父级模型", async () => {
  const user = userEvent.setup();
  let current;
  function Harness() {
    const [value, setValue] = useState({
      logic: "AND" as const,
      children: [{ field: "amount", operator: "GT" as const, value: "1000" }],
    });
    return (
      <ConditionGroupEditor
        fields={[{ id: "amount", label: "金额", type: "MONEY" }]}
        value={value}
        onChange={(next) => {
          current = next;
          setValue(next);
        }}
      />
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>,
  );
  await user.click(screen.getByRole("button", { name: "添加分组" }));
  assert.equal(current.children.length, 2);
  const group = screen.getByRole("region", { name: "条件组1.2" });
  await user.click(within(group).getByLabelText("条件组1.2关系"));
  await user.click(screen.getByText("以下条件任一满足"));
  assert.equal(current.children[1].logic, "OR");
  await user.click(within(group).getByRole("button", { name: "添加判断" }));
  assert.equal(current.children[1].children.length, 2);
  await user.click(screen.getByRole("button", { name: "删除判断1.2.2" }));
  assert.equal(current.children[1].children.length, 1);
  assert.equal(current.children[0].value, "1000");
});
