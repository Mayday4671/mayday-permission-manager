import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, tokenStore } from "./api";
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
  const refresh = useCallback(async () => {
    setSession(await api<AuthSession>("/auth/me"));
  }, []);
  useEffect(() => {
    if (tokenStore.get())
      refresh()
        .catch((error) => {
          // 短暂断网或后端重启不撤销仍有效的令牌；只有明确的 401 才清理认证。
          if (error instanceof ApiError && error.status === 401)
            tokenStore.clear();
          setSession(null);
        })
        .finally(() => setLoading(false));
    else setLoading(false);
    const expired = () => {
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
    const result = await api<{ token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, captchaToken }),
    });
    client.clear();
    tokenStore.set(result.token);
    try {
      await refresh();
    } catch (error) {
      tokenStore.clear();
      throw error;
    }
  };
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      tokenStore.clear();
      setSession(null);
      client.clear();
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
        can: (p) => session?.permissions.includes(p) ?? false,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider 未挂载");
  return ctx;
}
