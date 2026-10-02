import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Result, Spin } from "antd";
import { contractClient, unwrapContract } from "./contract-client";

const ModulesContext = createContext<Readonly<Record<string, boolean>> | null>(
  null,
);

/** 启动时获取服务端有效模块清单；失败不猜测全部开启，提供重试入口，避免暂时暴露关闭功能。 */
export function ModulesProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["platform", "features"],
    queryFn: async () =>
      unwrapContract(await contractClient.GET("/api/platform/features")),
    staleTime: 30000,
    refetchInterval: 30000,
  });
  if (query.isPending)
    return (
      <div className="full-loading">
        <Spin />
      </div>
    );
  if (!query.data?.modules)
    return (
      <Result
        status="500"
        title="服务连接失败"
        extra={<Button onClick={() => void query.refetch()}>重新连接</Button>}
      />
    );
  return (
    <ModulesContext.Provider value={query.data.modules}>
      {children}
    </ModulesContext.Provider>
  );
}

export function useModules() {
  const modules = useContext(ModulesContext);
  if (!modules) throw new Error("ModulesProvider 未挂载");
  return modules;
}
