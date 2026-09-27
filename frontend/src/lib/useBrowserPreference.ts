import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { preferenceKey } from "./list-preferences";

/** 非业务数据的显式偏好按账号、页面、组件隔离；禁用存储时退化为当前页面内存。 */
export function useBrowserPreference<T>(
  name: string,
  parse: (raw: unknown) => T,
) {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const key = preferenceKey(session?.user.id ?? "anonymous", pathname, name);
  const read = useCallback(() => {
    try {
      return parse(JSON.parse(localStorage.getItem(key) ?? "null"));
    } catch {
      return parse(null);
    }
  }, [key, parse]);
  const [state, setState] = useState(() => ({ key, value: read() }));
  const value = state.key === key ? state.value : read();
  const latest = useRef({ key, value });
  latest.current = { key, value };
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      const current =
        latest.current.key === key ? latest.current.value : read();
      const resolved = parse(
        typeof next === "function" ? (next as (v: T) => T)(current) : next,
      );
      let persisted = true;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        persisted = false; /* 禁用存储时仍允许当前页面使用，调用方可提示无法持久保存。 */
      }
      latest.current = { key, value: resolved };
      setState(latest.current);
      return persisted;
    },
    [key, read, parse],
  );
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === key || event.key === null)
      )
        setState({ key, value: read() });
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key, read]);
  return [value, setValue] as const;
}
