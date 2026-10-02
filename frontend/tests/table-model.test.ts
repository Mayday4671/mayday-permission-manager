import assert from "node:assert/strict";
import test from "node:test";
import {
  moveColumnKey,
  orderColumnKeys,
  readColumnLayout,
  fitPageSize,
} from "../src/lib/table-model";
import { readPageSizePreference } from "../src/lib/list-preferences";

test("列布局过滤已撤权列并保留新列，不从历史偏好恢复敏感字段", () => {
  assert.deepEqual(orderColumnKeys(["name", "status"], ["email", "status"]), [
    "status",
    "name",
  ]);
  assert.deepEqual(moveColumnKey(["name", "status", "time"], "time", "name"), [
    "time",
    "name",
    "status",
  ]);
  assert.deepEqual(moveColumnKey(["name", "status"], "email", "name"), [
    "name",
    "status",
  ]);
});

test("列宽限制和损坏存储恢复，避免 NaN 与超大列宽撑开页面", () => {
  assert.deepEqual(
    readColumnLayout({
      order: ["name", "name", 3],
      widths: { name: 9999, status: 1, invalid: "99" },
    }),
    { order: ["name"], widths: { name: 800, status: 80 } },
  );
  assert.deepEqual(readColumnLayout(null), { order: [], widths: {} });
});

test("默认页大小适配实际行高，已保存明确偏好优先于自动档位", () => {
  assert.equal(fitPageSize(650, 64), 10);
  assert.equal(fitPageSize(430, 70), 5);
  assert.equal(fitPageSize(210, 64), 3);
  assert.equal(fitPageSize(260, 170), 1);
  assert.equal(readPageSizePreference(null), null);
  assert.equal(readPageSizePreference(9999), null);
  assert.equal(readPageSizePreference(50) ?? fitPageSize(210, 64), 50);
  assert.equal(readPageSizePreference(20) ?? fitPageSize(430, 70), 20);
});
