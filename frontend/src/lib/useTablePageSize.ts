import { useLayoutEffect, useState, type RefObject } from "react";
import { fitPageSize } from "./table-model";
import type { Density } from "./list-preferences";

/**
 * 只计算没有显式偏好时的默认条数。按实际工具栏、表头、行高与页脚保留分页空间，
 * 缩略图、多行成员信息和手机卡片也参与测量，避免把普通 10 行表强行塞进矮窗口。
 */
export function useTablePageSize(
  panel: RefObject<HTMLDivElement | null>,
  density: Density,
) {
  const [automatic, setAutomatic] = useState(10);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const rectangle = element.getBoundingClientRect();
      if (rectangle.width <= 0) return;
      const toolbar =
        element.querySelector(".table-toolbar")?.getBoundingClientRect()
          .height ?? 48;
      const header =
        element.querySelector(".ant-table-thead")?.getBoundingClientRect()
          .height ?? 0;
      const batch =
        element.querySelector(".batch-toolbar")?.getBoundingClientRect()
          .height ?? 0;
      const card = element.querySelector(".table-mobile-card");
      const row = card ?? element.querySelector(".ant-table-row");
      const rowHeight =
        row?.getBoundingClientRect().height ||
        (card ? 180 : density === "small" ? 48 : density === "large" ? 76 : 64);
      const footer =
        document.querySelector(".admin-footer")?.getBoundingClientRect()
          .height ?? 44;
      const style = getComputedStyle(element);
      const padding =
        (Number.parseFloat(style.paddingTop) || 16) +
        (Number.parseFloat(style.paddingBottom) || 16);
      // 工具栏包含其底部 padding；分页区和页面下缘额外预留，鼠标焦点不挤出一像素滚动条。
      const available =
        window.innerHeight -
        rectangle.top -
        toolbar -
        header -
        batch -
        padding -
        footer -
        80;
      setAutomatic(fitPageSize(available, rowHeight));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [panel, density]);
  return automatic;
}
