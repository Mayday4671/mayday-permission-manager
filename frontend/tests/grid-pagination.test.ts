import assert from "node:assert/strict";
import test from "node:test";
import {
  fitArticleGrid,
  fitGrid,
  resizeGridPage,
} from "../src/lib/grid-pagination";

test("文章卡片优先铺三行并缩小高度，完整行不超出可用区域", () => {
  // 宽高是扣除导航、工具栏和页脚之后的网格空间，覆盖笔记本/桌面/窄窗口。
  for (const [width, height] of [
    [1000, 430],
    [1770, 750],
    [1600, 680],
    [2100, 920],
    [340, 390],
    [740, 620],
  ]) {
    const minWidth = width < 480 ? 150 : 196;
    const { columns, pageSize, rowHeight } = fitArticleGrid(
      width,
      height,
      minWidth,
    );
    const rows = Math.ceil(pageSize / columns);
    assert(rows * rowHeight + (rows - 1) * 12 <= height);
    assert(columns * minWidth + (columns - 1) * 12 <= width);
    assert(rowHeight >= 196 && rowHeight <= 260);
    assert.equal(pageSize % columns, 0);
    assert(pageSize <= 24);
  }
  assert.deepEqual(fitArticleGrid(1770, 750), {
    columns: 8,
    pageSize: 24,
    rowHeight: 242,
  });
  assert.equal(fitArticleGrid(1000, 430).pageSize, 8, "矮窗口减少到两行");
  assert.equal(
    fitArticleGrid(2100, 750).pageSize,
    24,
    "超宽窗口仍保留完整三行",
  );
});

test("抽屉按自身空间分页，窄屏不会沿用桌面列数", () => {
  assert.deepEqual(fitGrid(868, 630, 150, 174, 12, 24), {
    columns: 5,
    pageSize: 15,
  });
  assert.deepEqual(fitGrid(340, 390, 150, 174, 12, 24), {
    columns: 2,
    pageSize: 4,
  });
  assert.deepEqual(fitGrid(868, 850, 150, 174, 12, 24), {
    columns: 5,
    pageSize: 20,
  });
});

test("缩放窗口保留原来第一条所在页，极矮窗口至少仍可查看一行", () => {
  assert.equal(resizeGridPage(3, 12, 8), 4);
  assert.equal(resizeGridPage(3, 8, 12), 2);
  const small = fitGrid(280, 100, 150, 174, 12, 24);
  assert.equal(small.pageSize, 1);
});
