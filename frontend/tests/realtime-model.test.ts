import assert from "node:assert/strict";
import test from "node:test";
import { consumeSse } from "../src/lib/realtime-model";

test("分块 JSON 与 CRLF 边界完整后才消费，不丢失下一条事件", () => {
  const first = consumeSse('event: changed\r\ndata: {"topics":["mes');
  assert.equal(first.events.length, 0);
  const second = consumeSse(
    first.remainder + 'sages"]}\r\n\r\nevent: heartbeat\r\ndata: {}\r\n\r\n',
  );
  assert.deepEqual(second.events, [
    { event: "changed", data: '{"topics":["messages"]}' },
    { event: "heartbeat", data: "{}" },
  ]);
  assert.equal(second.remainder, "");
});

test("注释与重试字段不伪造业务事件，多行 data 正常合并", () => {
  assert.deepEqual(
    consumeSse(": ping\nretry: 3000\n\nevent: changed\ndata: a\ndata: b\n\n")
      .events,
    [{ event: "changed", data: "a\nb" }],
  );
});

test("未终止的过大事件不永久占用内存", () => {
  const large = "data: " + "a".repeat(65537);
  assert.equal(consumeSse(large).remainder, "");
  assert.deepEqual(consumeSse(large + "\n\n").events, []);
});
