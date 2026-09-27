import { useCallback, useLayoutEffect, useState } from "react";
import { resizeGridPage } from "../lib/grid-pagination";

/**
 * 弹窗表格按实际可用高度向服务端请求整页记录，不靠隐藏正文滚动条裁掉数据。
 * 使用弹窗的最大高度和正文内部偏移，避免居中位置随条数变化造成反复增减。
 * ref 放在 DataTable 外层；其前面的摘要、筛选栏和表格自身都参与尺寸观察。
 */
export function useModalTablePagination(rowHeight = 64, limit = 10) {
  const [node, ref] = useState<HTMLDivElement | null>(null);
  const [state, setState] = useState({ page: 1, pageSize: 5 });
  const setPage = useCallback(
    (page: number) =>
      setState((previous) =>
        previous.page === page ? previous : { ...previous, page },
      ),
    [],
  );

  useLayoutEffect(() => {
    const body = node?.closest<HTMLElement>(".ant-modal-body");
    const frame = body?.closest<HTMLElement>(".ant-modal-container");
    if (!node || !body || !frame) return;
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    const header = frame.querySelector<HTMLElement>(".ant-modal-header");
    const footer = frame.querySelector<HTMLElement>(".ant-modal-footer");
    const update = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0) return;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const availableHeight = viewport - (window.innerWidth <= 575 ? 32 : 48);
      const maximum = Math.min(
        availableHeight,
        pixels(getComputedStyle(frame).maxHeight) || availableHeight,
      );
      const pager = node.querySelector<HTMLElement>(".ant-pagination");
      const pagerHeight = pager
        ? pager.getBoundingClientRect().height +
          pixels(getComputedStyle(pager).marginTop) +
          pixels(getComputedStyle(pager).marginBottom)
        : 56;
      const tableHead = node.querySelector<HTMLElement>(".ant-table-thead");
      // 稳定两行内容仍可能被用户字体设置放大，以当前真实行高作为可读下限。
      const actualRow = node.querySelector<HTMLElement>(
        ".ant-table-tbody > .ant-table-row",
      );
      const height = Math.max(
        rowHeight,
        actualRow?.getBoundingClientRect().height ?? 0,
      );
      const offset =
        rect.top - body.getBoundingClientRect().top + body.scrollTop;
      const remaining =
        maximum -
        (header?.getBoundingClientRect().height ?? 60) -
        (footer?.getBoundingClientRect().height ?? 60) -
        offset -
        pixels(getComputedStyle(body).paddingBottom) -
        (tableHead?.getBoundingClientRect().height || 40) -
        pagerHeight -
        4;
      const pageSize = Math.max(
        1,
        Math.min(limit, Math.floor(remaining / height)),
      );
      setState((previous) =>
        previous.pageSize === pageSize
          ? previous
          : {
              pageSize,
              page: resizeGridPage(previous.page, previous.pageSize, pageSize),
            },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    for (const element of [
      node,
      body,
      frame,
      header,
      footer,
      ...Array.from(node.parentElement?.children ?? []),
    ]) {
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    // Ant 居中弹窗的入场缩放不触发 ResizeObserver，动画结束后按最终尺寸再核对一次。
    const motion = frame.closest(".ant-modal") ?? frame;
    motion.addEventListener("animationend", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      motion.removeEventListener("animationend", update);
    };
  }, [node, rowHeight, limit]);

  return { ...state, ref, setPage };
}
