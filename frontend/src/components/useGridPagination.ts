import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  fitArticleGrid,
  fitGrid,
  resizeGridPage,
} from "../lib/grid-pagination";

/**
 * 卡片页面与抽屉共用的空间分页。
 * 页面模式从网格顶部算到页脚，并扣除真实的容器内边距与分页高度；
 * 抽屉模式使用 flex 布局分配给网格的高度。两者均不靠隐藏文档滚动条掩盖溢出。
 */
export function useGridPagination(mode: "page" | "container") {
  const ref = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({
    page: 1,
    pageSize: mode === "page" ? 8 : 12,
    columns: 4,
    rowHeight: mode === "page" ? 240 : 174,
    compact: false,
  });
  const setPage = useCallback(
    (page: number) =>
      setState((previous) =>
        previous.page === page ? previous : { ...previous, page },
      ),
    [],
  );
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const footer = document.querySelector<HTMLElement>(".admin-footer");
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    const update = () => {
      const rect = node.getBoundingClientRect();
      // 尚未布局（隐藏页签、测试环境）保持稳定初值，显示后由 ResizeObserver 重新计算。
      if (rect.width <= 0) return;
      const ownStyle = getComputedStyle(node);
      const width =
        rect.width -
        pixels(ownStyle.paddingLeft) -
        pixels(ownStyle.paddingRight);
      let height =
        rect.height -
        pixels(ownStyle.paddingTop) -
        pixels(ownStyle.paddingBottom);
      if (mode === "page") {
        const modal = node.closest<HTMLElement>(".ant-modal-body");
        const scroll = window.scrollY;
        let bottom = window.visualViewport?.height ?? window.innerHeight;
        if (!modal && footer) {
          const style = getComputedStyle(footer);
          bottom -=
            footer.getBoundingClientRect().height +
            pixels(style.marginTop) +
            pixels(style.marginBottom);
        }
        let tail = 0;
        for (
          let parent = node.parentElement;
          parent &&
          parent !== modal &&
          !parent.classList.contains("admin-main");
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent);
          tail +=
            pixels(style.paddingBottom) +
            pixels(style.borderBottomWidth) +
            pixels(style.marginBottom);
          if (parent.classList.contains("page-content")) break;
        }
        const pager = pagerRef.current;
        const pagerHeight = pager
          ? pager.getBoundingClientRect().height +
            pixels(getComputedStyle(pager).marginTop)
          : 48;
        height = bottom - rect.top - scroll - tail - pagerHeight - 4;
        if (modal) {
          // 居中弹窗的位置会随卡片数量改变。必须使用弹窗最大容量和正文内部偏移，
          // 而不是当前窗口坐标，避免“多一行→弹窗上移→再多一行”的反馈循环。
          const frame = modal.closest<HTMLElement>(".ant-modal-container");
          const header = frame?.querySelector<HTMLElement>(".ant-modal-header");
          const actions =
            frame?.querySelector<HTMLElement>(".ant-modal-footer");
          const limit = frame ? pixels(getComputedStyle(frame).maxHeight) : 0;
          const maxHeight =
            limit || bottom - (window.innerWidth <= 575 ? 32 : 48);
          const offset =
            rect.top - modal.getBoundingClientRect().top + modal.scrollTop;
          height =
            maxHeight -
            (header?.getBoundingClientRect().height ?? 60) -
            (actions?.getBoundingClientRect().height ?? 60) -
            offset -
            pixels(getComputedStyle(modal).paddingBottom) -
            tail -
            pagerHeight -
            4;
        }
      }
      const compact = width < 480;
      const next =
        mode === "page"
          ? fitArticleGrid(width, height, compact ? 150 : 196)
          : { ...fitGrid(width, height, 150, 174, 12, 24), rowHeight: 174 };
      setState((previous) =>
        previous.pageSize === next.pageSize &&
        previous.columns === next.columns &&
        previous.rowHeight === next.rowHeight &&
        previous.compact === compact
          ? previous
          : {
              ...next,
              compact,
              page: resizeGridPage(
                previous.page,
                previous.pageSize,
                next.pageSize,
              ),
            },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (pagerRef.current) observer.observe(pagerRef.current);
    if (footer) observer.observe(footer);
    // 搜索栏或操作栏换行会改变网格起点，但不一定改变网格自身宽度。
    node.parentElement
      ?.querySelectorAll<HTMLElement>(".crawl-articles-toolbar")
      .forEach((el) => observer.observe(el));
    node
      .closest(".page-content")
      ?.querySelectorAll<HTMLElement>(".crawl-page-toolbar")
      .forEach((el) => observer.observe(el));
    node
      .closest(".ant-modal-container")
      ?.querySelectorAll<HTMLElement>(
        ".ant-modal-header, .ant-modal-footer, .ant-descriptions, .crawl-result-tabs",
      )
      .forEach((el) => observer.observe(el));
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [mode]);
  return {
    ...state,
    ref,
    pagerRef,
    setPage,
  };
}
