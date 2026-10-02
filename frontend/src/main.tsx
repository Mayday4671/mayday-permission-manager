import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "@fontsource-variable/dm-sans";
import { AuthProvider } from "./lib/auth";
import { ModulesProvider } from "./lib/modules";
import { ApiError } from "./lib/api";
import { AppearanceProvider } from "./lib/theme";
import Application, { ErrorBoundary } from "./App";
import "./styles.css";
import "./admin.css";
import "./theme.css";

dayjs.locale("zh-cn");
/** 统一查询缓存与重试规则；动态主题由路由内的 AppearanceProvider 提供。 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
});
// 数据路由统一拦截站内导航及浏览器后退，避免设计器未保存的修改意外丢失。
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <ErrorBoundary>
        <ModulesProvider>
          <AuthProvider>
            <AppearanceProvider>
              <Application />
            </AppearanceProvider>
          </AuthProvider>
        </ModulesProvider>
      </ErrorBoundary>
    ),
  },
]);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
