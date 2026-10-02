import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { JSDOM } from "jsdom";

// 使用可控制宽度的 DOM 环境验证行为；这些断言不代替真实浏览器中的主题和视觉验收。
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
  "Event",
  "MouseEvent",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
globalThis.getComputedStyle = (element) => dom.window.getComputedStyle(element);
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let containerWidth = 1000;
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get() {
    return this.classList.contains("data-table-container") ? containerWidth : 0;
  },
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
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
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};

const React = await import("react");
const { useState } = React;
const { render, screen, cleanup, within, fireEvent } =
  await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { ConfigProvider, App, Button } = await import("antd");
const { DataTable } = await import("../src/components/DataTable");
const { visibleTableRows } = await import("../src/lib/table-output");
const rows = [
  { id: 11, name: "Alpha", enabled: "启用" },
  { id: 12, name: "Beta", enabled: "停用" },
];
const columns = [
  { title: "成员", key: "name", dataIndex: "name", width: 180 },
  { title: "状态", key: "enabled", dataIndex: "enabled", width: 100 },
  {
    title: "操作",
    key: "actions",
    render: (_, row) => <Button>编辑 {row.name}</Button>,
  },
];

function MobileTable() {
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  return (
    <DataTable
      rowKey="id"
      columns={columns}
      dataSource={rows}
      aria-label="成员列表"
      pagination={{ defaultPageSize: 1, total: 2, showSizeChanger: false }}
      rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
    />
  );
}
function mount(content) {
  return render(
    <ConfigProvider theme={{ cssVar: true }}>
      <App>{content}</App>
    </ConfigProvider>,
  );
}
afterEach(() => {
  cleanup();
  containerWidth = 1000;
});
after(() => {
  channels.forEach((channel) => {
    channel.port1.close();
    channel.port2.close();
  });
  dom.window.close();
});

test("窄屏卡片保留序号、选择、操作与分页，导出只含当前可见授权字段", async () => {
  containerWidth = 420;
  const user = userEvent.setup();
  const view = mount(<MobileTable />);
  let card = within(
    (await screen.findAllByRole("listitem")).find((item) =>
      item.classList.contains("table-mobile-card"),
    ),
  );
  assert.ok(card.getByText("Alpha"));
  assert.ok(card.getByText("序号 1"));
  assert.ok(card.getByRole("button", { name: "编辑 Alpha" }));
  await user.click(card.getByRole("checkbox", { name: "选择第1条记录" }));
  assert.equal(card.getByRole("checkbox").checked, true);
  assert.deepEqual(visibleTableRows(view.container), [
    ["序号", "成员", "状态"],
    ["1", "Alpha", "启用"],
  ]);
  await user.click(screen.getByTitle("2"));
  card = within(
    screen
      .getAllByRole("listitem")
      .find((item) => item.classList.contains("table-mobile-card")),
  );
  assert.ok(card.getByText("Beta"));
  assert.ok(card.getByText("序号 2"));
  assert.deepEqual(visibleTableRows(view.container), [
    ["序号", "成员", "状态"],
    ["2", "Beta", "停用"],
  ]);
});

test("列宽手柄可键盘操作，拖列不会改变表头名称或导出操作按钮", async () => {
  const changes = [],
    moves = [];
  const view = mount(
    <DataTable
      rowKey="id"
      columns={columns}
      dataSource={rows}
      pagination={false}
      onColumnResize={(key, width) => changes.push([key, width])}
      onColumnReorder={(source, target) => moves.push([source, target])}
    />,
  );
  const member = await screen.findByRole("columnheader", { name: "成员" });
  const status = screen.getByRole("columnheader", { name: "状态" });
  fireEvent.keyDown(
    within(member).getByRole("separator", { name: "调整成员列宽" }),
    { key: "ArrowRight" },
  );
  assert.deepEqual(changes, [["name", 196]]);
  const data = new Map();
  const transfer = {
    types: ["text/x-mayday-column"],
    setData: (key, value) => data.set(key, value),
    getData: (key) => data.get(key),
    effectAllowed: "move",
  };
  fireEvent.dragStart(member.querySelector(".table-column-title"), {
    dataTransfer: transfer,
  });
  fireEvent.drop(status.querySelector(".table-column-title"), {
    dataTransfer: transfer,
  });
  assert.deepEqual(moves, [["name", "enabled"]]);
  assert.deepEqual(visibleTableRows(view.container), [
    ["序号", "成员", "状态"],
    ["1", "Alpha", "启用"],
    ["2", "Beta", "停用"],
  ]);
});
