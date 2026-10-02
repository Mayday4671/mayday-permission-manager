import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, tokenStore } from "./api";
import { contractClient, unwrapContract } from "./contract-client";
import type { AuthSession } from "../types";

interface AuthValue {
  session: AuthSession | null;
  loading: boolean;
  login: (
    username: string,
    password: string,
    captchaToken: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
}
const AuthContext = createContext<AuthValue | null>(null);

/** 身份上下文只负责会话；业务数据交给 React Query，登出时清空全部缓存以防跨账号残留。 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const client = useQueryClient();
  const identityRevision = useRef(0);
  const refresh = useCallback(async () => {
    const requestedToken = tokenStore.get();
    const revision = ++identityRevision.current;
    const updated = unwrapContract(await contractClient.GET("/api/auth/me"));
    // 并发刷新只接纳最新响应；退出或切换账号后到达的旧响应不能恢复旧身份。
    if (
      revision === identityRevision.current &&
      requestedToken === tokenStore.get()
    )
      setSession(updated);
  }, []);
  useEffect(() => {
    const initialToken = tokenStore.get();
    if (initialToken) {
      const initialRefresh = refresh();
      const initialRevision = identityRevision.current;
      initialRefresh
        .catch((error) => {
          if (
            initialToken !== tokenStore.get() ||
            initialRevision !== identityRevision.current
          )
            return;
          // 短暂断网或后端重启不撤销仍有效的令牌；只有明确的 401 才清理认证。
          if (error instanceof ApiError && error.status === 401)
            tokenStore.clear();
          setSession(null);
        })
        .finally(() => setLoading(false));
    } else setLoading(false);
    const expired = () => {
      identityRevision.current++;
      setSession(null);
      client.clear();
    };
    window.addEventListener("mayday:unauthorized", expired);
    // 切回窗口重新获取权限，让角色调整及时反映到菜单与按钮。
    const focus = () => {
      if (tokenStore.get()) void refresh().catch(() => {});
    };
    window.addEventListener("focus", focus);
    // 同一窗口持续使用也应看到角色撤回；服务端仍对每次请求独立鉴权。
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") focus();
    }, 30000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("mayday:unauthorized", expired);
      window.removeEventListener("focus", focus);
    };
  }, [client, refresh]);
  const login = async (
    username: string,
    password: string,
    captchaToken: string,
  ) => {
    const result = unwrapContract(
      await contractClient.POST("/api/auth/login", {
        body: { username, password, captchaToken },
      }),
    );
    client.clear();
    identityRevision.current++;
    tokenStore.set(result.token);
    try {
      await refresh();
    } catch (error) {
      if (result.token === tokenStore.get()) {
        identityRevision.current++;
        tokenStore.clear();
        setSession(null);
      }
      throw error;
    }
  };
  const logout = async () => {
    const requestedToken = tokenStore.get();
    identityRevision.current++;
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      if (requestedToken === tokenStore.get()) {
        identityRevision.current++;
        tokenStore.clear();
        setSession(null);
        client.clear();
      }
    }
  };
  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        login,
        logout,
        refresh,
        can: (permission) => session?.permissions.includes(permission) ?? false,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
/** 会话和按钮可用性取自同一个上下文；此处只控制界面，服务端仍独立鉴权。 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider 未挂载");
  return context;
}
