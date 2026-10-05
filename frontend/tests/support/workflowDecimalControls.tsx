import assert from "node:assert/strict";
import { format } from "node:util";
import { JSDOM } from "jsdom";
import type { FormInstance } from "antd";
import type { WorkflowField } from "../../src/types/workflow";

/**
 * HTTP 验收从此子进程取得真实控件产物：字段属性和填写值都经正常键盘输入生成。
 * 脚本只使用合成 DOM，不连接服务、不读取身份信息；stdout 专供机器 JSON 契约。
 * 控件或依赖产生的普通诊断统一送往 stderr，避免破坏父进程 JSON.parse。
 */
const diagnostic = (...values: unknown[]) =>
  process.stderr.write(`${format(...values)}\n`);
console.log = diagnostic;
console.info = diagnostic;
console.debug = diagnostic;

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

// 主/明细只渲染 NUMBER、MONEY，若意外触发任何联网路径则直接让 fixture 失败。
globalThis.fetch = async () => {
  throw new Error("十进制控件 fixture 不允许访问网络");
};

const React = await import("react");
const { useState } = React;
const { render, screen, cleanup, waitFor } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { Button, ConfigProvider, Form } = await import("antd");
const { WorkflowFields, encodeWorkflowValues, hydrateWorkflowValues } =
  await import("../../src/components/WorkflowFields");
const { WorkflowFieldProperties } =
  await import("../../src/components/workflow/WorkflowFieldProperties");
const { validateWorkflowFields, validateWorkflowFormValues } =
  await import("../../src/lib/workflowForm");

type WorkflowFormValues = { values: Record<string, unknown> };

/** 属性状态由控件回调更新；初始字段没有上下限，不直接给模型塞入精确边界。 */
function mountMoneyProperties() {
  let current: WorkflowField = {
    id: "money",
    label: "精确金额",
    type: "MONEY",
    required: true,
  };
  function Harness() {
    const [field, setField] = useState(current);
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

/**
 * 第一轮 initialValues 为空；第二轮仅回填第一轮真实提交产物，验证 hydrate 续编链路。
 * 收集值必须点击正常 Form 提交按钮并通过校验，不通过 setFieldsValue 注入精确数值。
 */
function mountWorkflowForm(
  fields: WorkflowField[],
  initialValues: Record<string, unknown> = {},
) {
  let submitted: Record<string, unknown> | undefined;
  let formInstance: FormInstance<WorkflowFormValues>;
  function Harness() {
    const [form] = Form.useForm<WorkflowFormValues>();
    formInstance = form;
    return (
      <Form
        form={form}
        initialValues={{ values: initialValues }}
        onFinish={({ values }) => {
          submitted = encodeWorkflowValues(fields, values);
        }}
      >
        <WorkflowFields fields={fields} />
        <Button htmlType="submit">采集填写结果</Button>
      </Form>
    );
  }
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <Harness />
    </ConfigProvider>,
  );
  return {
    values: () => formInstance.getFieldValue("values"),
    submitted: () => submitted,
  };
}

async function typeDecimal(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string,
) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  await user.clear(input);
  await user.type(input, value);
  assert.equal(document.activeElement, input);
  await user.tab();
  assert.equal(input.value, value);
}

try {
  const user = userEvent.setup();
  const money = mountMoneyProperties();
  await typeDecimal(user, "最小值", "999999999999999.98");
  await typeDecimal(user, "最大值", "999999999999999.99");
  assert.equal(money().min, "999999999999999.98");
  assert.equal(money().max, "999999999999999.99");
  const fields: WorkflowField[] = [
    structuredClone(money()),
    {
      id: "number",
      label: "精确数字",
      type: "NUMBER",
      required: true,
    },
    {
      id: "details",
      label: "精确明细",
      type: "DETAILS",
      required: true,
      maxRows: 20,
      columns: [
        {
          id: "amount",
          label: "明细金额",
          type: "MONEY",
          required: true,
        },
      ],
    },
  ];
  assert.deepEqual(validateWorkflowFields(fields), []);
  cleanup();

  const expected = {
    money: "999999999999999.99",
    number: "999999999999.123456",
    details: [{ amount: "99999999999999.99" }],
  };
  const first = mountWorkflowForm(fields);
  assert.deepEqual(first.values(), {});
  await typeDecimal(user, "精确金额", expected.money);
  await typeDecimal(user, "精确数字", expected.number);
  await user.click(screen.getByRole("button", { name: "添加明细 (0/20)" }));
  await typeDecimal(user, "第1行明细金额", expected.details[0].amount);
  await user.click(screen.getByRole("button", { name: "采集填写结果" }));
  await waitFor(() => assert.deepEqual(first.submitted(), expected));
  assert.deepEqual(validateWorkflowFormValues(fields, first.values()), []);
  const hydrated = hydrateWorkflowValues(fields, first.submitted()!, []);
  assert.deepEqual(hydrated, expected);
  cleanup();

  // 回填后先把末位改小，再正常改回最终值；每次键盘更新均验证完整精确值。
  const resumed = mountWorkflowForm(fields, hydrated);
  for (const sample of [
    { label: "精确金额", interim: "999999999999999.98", value: expected.money },
    {
      label: "精确数字",
      interim: "999999999999.123455",
      value: expected.number,
    },
    {
      label: "第1行明细金额",
      interim: "99999999999999.98",
      value: expected.details[0].amount,
    },
  ]) {
    const input = screen.getByLabelText(sample.label) as HTMLInputElement;
    assert.equal(input.value, sample.value);
    await user.click(input);
    await user.keyboard(`{End}{Backspace}${sample.interim.at(-1)}`);
    assert.equal(input.value, sample.interim);
    await user.keyboard(`{End}{Backspace}${sample.value.at(-1)}`);
    assert.equal(document.activeElement, input);
    await user.tab();
    assert.equal(input.value, sample.value);
  }
  await user.click(screen.getByRole("button", { name: "采集填写结果" }));
  await waitFor(() => assert.deepEqual(resumed.submitted(), expected));
  assert.deepEqual(validateWorkflowFormValues(fields, resumed.values()), []);
  const values = structuredClone(resumed.submitted()!);
  cleanup();

  // BigDecimal 负 scale 的旧值以指数表示回填；无修改的 focus/blur 不得重写为 1000。
  // 这一路产物独立追加到输出，已有主/明细 HTTP 验收仍使用原 values 与 fields。
  const exponentFields: WorkflowField[] = [
    { id: "exponent", label: "指数数字", type: "NUMBER", required: true },
  ];
  const expectedExponent = { exponent: "1E+3" };
  const exponent = mountWorkflowForm(
    exponentFields,
    hydrateWorkflowValues(exponentFields, expectedExponent, []),
  );
  assert.deepEqual(exponent.values(), expectedExponent);
  const exponentInput = screen.getByLabelText("指数数字") as HTMLInputElement;
  await user.click(exponentInput);
  assert.equal(document.activeElement, exponentInput);
  await user.tab();
  assert.notEqual(document.activeElement, exponentInput);
  assert.deepEqual(exponent.values(), expectedExponent);
  await user.click(screen.getByRole("button", { name: "采集填写结果" }));
  await waitFor(() => assert.deepEqual(exponent.submitted(), expectedExponent));
  assert.deepEqual(
    validateWorkflowFormValues(exponentFields, exponent.values()),
    [],
  );
  assert.equal(String(exponent.submitted()!.exponent).includes("000"), false);
  process.stdout.write(
    `${JSON.stringify({
      values,
      fields,
      exponent: { fields: exponentFields, values: exponent.submitted() },
    })}\n`,
  );
} finally {
  cleanup();
  dom.window.close();
  channels.forEach(({ port1, port2 }) => {
    port1.close();
    port2.close();
  });
}
