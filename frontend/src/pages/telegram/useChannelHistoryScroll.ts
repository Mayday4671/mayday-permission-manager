import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

interface HistoryScrollOptions {
  scope: string;
  pageCount: number;
  hasMore: boolean;
  fetching: boolean;
  failed: boolean;
  loadMore: () => Promise<unknown>;
}

interface ReadingPosition {
  scope: string;
  pageCount: number;
  element: HTMLElement | null;
  offset: number;
  height: number;
}

/** 上滚自动读取历史消息；追加前后以可见消息为锚点，保留用户的阅读位置。 */
export function useChannelHistoryScroll({
  scope,
  pageCount,
  hasMore,
  fetching,
  failed,
  loadMore,
}: HistoryScrollOptions) {
  const transcript = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const activeScope = useRef("");
  const positioned = useRef(false);
  const request = useRef<object | null>(null);
  const reading = useRef<ReadingPosition | null>(null);

  useLayoutEffect(() => {
    if (activeScope.current !== scope || pageCount === 0) {
      activeScope.current = scope;
      positioned.current = false;
      reading.current = null;
      request.current = null;
    }
    const pane = transcript.current;
    if (!pane || pageCount === 0) return;
    if (!positioned.current) {
      pane.scrollTop = pane.scrollHeight;
      positioned.current = true;
      return;
    }
    const position = reading.current;
    if (position?.scope === scope && pageCount > position.pageCount) {
      pane.scrollTop += position.element?.isConnected
        ? position.element.getBoundingClientRect().top - position.offset
        : pane.scrollHeight - position.height;
      reading.current = null;
    }
  }, [scope, pageCount]);

  const loadEarlier = useCallback(async () => {
    const pane = transcript.current;
    if (
      !pane ||
      !hasMore ||
      fetching ||
      request.current ||
      activeScope.current !== scope
    )
      return;
    const top = pane.getBoundingClientRect().top;
    const element =
      Array.from(
        pane.querySelectorAll<HTMLElement>("[data-channel-message]"),
      ).find((post) => post.getBoundingClientRect().bottom > top) ?? null;
    const currentRequest = {};
    request.current = currentRequest;
    reading.current = {
      scope,
      pageCount,
      element,
      offset: element?.getBoundingClientRect().top ?? 0,
      height: pane.scrollHeight,
    };
    try {
      await loadMore();
    } finally {
      if (request.current === currentRequest) request.current = null;
    }
  }, [scope, pageCount, hasMore, fetching, loadMore]);

  useEffect(() => {
    const pane = transcript.current;
    const sentinel = trigger.current;
    if (
      !pane ||
      !sentinel ||
      !hasMore ||
      fetching ||
      failed ||
      !positioned.current
    )
      return;
    let observing = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (observing && entries.some((entry) => entry.isIntersecting))
          void loadEarlier();
      },
      { root: pane, rootMargin: "120px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => {
      observing = false;
      observer.disconnect();
    };
  }, [scope, hasMore, fetching, failed, loadEarlier]);

  // 请求期间仍可滚动；按最新阅读位置还原，而非把用户拉回发起请求的位置。
  const trackReadingPosition = () => {
    const position = reading.current;
    if (position?.scope === scope && position.element?.isConnected)
      position.offset = position.element.getBoundingClientRect().top;
  };

  return { transcript, trigger, loadEarlier, trackReadingPosition };
}
