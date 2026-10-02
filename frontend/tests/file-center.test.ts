import assert from "node:assert/strict";
import test from "node:test";
import {
  directoryOptions,
  directoryPath,
  formatFileSize,
} from "../src/lib/file-center";
import type { FileDirectory } from "../src/types/operations";

/** 模型测试覆盖异常目录循环和跨账户目录选项，不依赖浏览器布局或伪造生产登录。 */
const directories: FileDirectory[] = [
  {
    id: 1,
    parentId: 0,
    ownerId: 8,
    ownerName: "甲",
    name: "资料",
    version: 0,
    createdAt: "2026-01-01",
  },
  {
    id: 2,
    parentId: 1,
    ownerId: 8,
    ownerName: "甲",
    name: "合同",
    version: 0,
    createdAt: "2026-01-01",
  },
  {
    id: 3,
    parentId: 0,
    ownerId: 9,
    ownerName: "乙",
    name: "财务",
    version: 0,
    createdAt: "2026-01-01",
  },
];

test("目录选择只提供当前所有者的目录，并展示完整路径", () => {
  assert.deepEqual(directoryOptions(directories, 8), [
    { value: 0, label: "根目录" },
    { value: 1, label: "资料" },
    { value: 2, label: "资料 / 合同" },
  ]);
});

test("未知目录和损坏的循环引用不会让页面无限递归", () => {
  assert.equal(directoryPath(null, directories), "根目录");
  assert.equal(directoryPath(999, directories), "根目录");
  const cyclic = directories.map((directory) =>
    directory.id === 1 ? { ...directory, parentId: 2 } : directory,
  );
  assert.equal(directoryPath(2, cyclic), "资料 / 合同");
});

test("文件大小按字节数选择单位，边界不出现 NaN 或空文本", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(1024), "1.0 KB");
  assert.equal(formatFileSize(1024 * 1024), "1.0 MB");
});
