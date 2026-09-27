/** 根据实际可用空间计算整行容量，避免固定 24 条把分页按钮推到屏幕外。 */
export function fitGrid(
  width: number,
  height: number,
  minWidth: number,
  rowHeight: number,
  gap: number,
  limit: number,
) {
  const columns = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
  const rows = Math.max(1, Math.floor((height + gap) / (rowHeight + gap)));
  // 限额也按整行取整，宽屏不会因为 24 条的上限留下半行卡片。
  const pageSize = Math.min(
    columns * rows,
    Math.max(columns, Math.floor(limit / columns) * columns),
    limit,
  );
  return { columns: Math.min(columns, limit), pageSize };
}

/**
 * 文章卡片优先铺三行，再分配每行高度，而不是先固定卡片高度再减少行数。
 * 196px 是紧凑卡片的可读下限；不足三行时依次退到两行、一行。
 * 列数也受每页 24 篇的接口限额约束，宽屏仍能形成完整三行。
 */
export function fitArticleGrid(width: number, height: number, minWidth = 196) {
  const gap = 12;
  const rows = Math.max(
    1,
    Math.min(3, Math.floor((height + gap) / (196 + gap))),
  );
  const columns = Math.max(
    1,
    Math.min(
      Math.floor((width + gap) / (minWidth + gap)),
      Math.floor(24 / rows),
    ),
  );
  const rowHeight = Math.min(
    260,
    Math.max(196, Math.floor((height - (rows - 1) * gap) / rows)),
  );
  return { columns, pageSize: columns * rows, rowHeight };
}

/** 改变窗口容量时保留原来正在看的第一条所在页；删除数据时退回仍存在的最后一页。 */
export function resizeGridPage(
  page: number,
  previousSize: number,
  nextSize: number,
) {
  return Math.floor(((page - 1) * previousSize) / nextSize) + 1;
}
