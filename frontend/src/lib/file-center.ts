import type { FileDirectory } from "../types/operations";

/** 文件中心从服务端取得上限，存储地址和密钥不进入页面的数据协议。 */
export interface FileStorageInfo {
  provider: "LOCAL" | "S3";
  maximumBytes: number;
  extensions: string[];
}

/** 字节大小的统一展示，列表、上传提示和详情使用相同单位规则。 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 目录显示路径仅使用已授权目录；遇到异常循环停止，不允许损坏的数据导致页面递归失控。 */
export function directoryPath(
  directoryId: number | null,
  directories: FileDirectory[],
): string {
  const names: string[] = [];
  const visited = new Set<number>();
  let current = directoryId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const directory = directories.find((item) => item.id === current);
    if (!directory) break;
    names.unshift(directory.name);
    current = directory.parentId;
  }
  return names.length ? names.join(" / ") : "根目录";
}

/** 移动选择器过滤其他用户目录，最终归属和目录有效性仍由后端验证。 */
export function directoryOptions(
  directories: FileDirectory[],
  ownerId?: number,
): { value: number; label: string }[] {
  return [
    { value: 0, label: "根目录" },
    ...directories
      .filter(
        (directory) => ownerId === undefined || directory.ownerId === ownerId,
      )
      .map((directory) => ({
        value: directory.id,
        label: directoryPath(directory.id, directories),
      })),
  ];
}
