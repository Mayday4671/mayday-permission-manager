/**
 * 源码仓库保留所有业务页面，契约必须由完整功能实例导出。
 * 部署时裁剪的接口仍由后端模块开关保护，不能用裁剪契约覆盖编译所需的路径。
 */
export function assertCompleteContractSource(features) {
  const modules = features?.data?.modules;
  if (
    features?.success !== true ||
    !modules ||
    typeof modules !== "object" ||
    Array.isArray(modules) ||
    Object.keys(modules).length === 0 ||
    Object.values(modules).some((enabled) => typeof enabled !== "boolean")
  ) {
    throw new Error("无法确认后端模块清单，已停止导出，原契约和类型保持不变");
  }
  const disabled = Object.entries(modules)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name)
    .sort();
  if (disabled.length > 0) {
    throw new Error(
      `契约来源关闭了模块：${disabled.join("、")}。请将 API_BASE 指向全模块启用的验收实例；已停止导出，原契约和类型保持不变`,
    );
  }
}
