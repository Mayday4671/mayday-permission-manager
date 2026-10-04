import type { components } from "../types/generated/api";
import { ApiError, responseError } from "./api";
import { contractClient, unwrapContract } from "./contract-client";

/** 导入预览只复用服务端公开的安全字段；文件中的初始密码不会进入业务状态模型。 */
export type ImportRow = components["schemas"]["ImportRow"];
/** 逐行校验结果来自真实控制器契约，不能由浏览器自行声明为已通过。 */
export type ImportPreview = components["schemas"]["ImportPreview"];
/** 作业公开模型只有本人进度和脱敏说明，不包含存储键、权限签名或原始筛选。 */
export type BulkJob = components["schemas"]["JobView"];

function importBody(file: File): FormData {
  const body = new FormData();
  body.append("file", file);
  return body;
}

/** 预览上传原文件，服务端重复验证字段和权限，不会创建账号或保存预览中的密码。 */
export async function previewImport(resource: string, file: File) {
  return unwrapContract(
    await contractClient.POST("/api/bulk/{resource}/import/preview", {
      params: { path: { resource } },
      // OpenAPI 将 binary 描述为 string；序列化器实际传输 File，浏览器负责 multipart 边界。
      body: { file: file.name },
      bodySerializer: () => importBody(file),
    }),
  );
}

/** 同一文件重试继续使用原幂等键；提交仍重新校验，服务器保证整批原子创建和不重复导入。 */
export async function commitImport(
  resource: string,
  file: File,
  idempotencyKey: string,
) {
  return unwrapContract(
    await contractClient.POST("/api/bulk/{resource}/import/commit", {
      params: { path: { resource }, query: { idempotencyKey } },
      body: { file: file.name },
      bodySerializer: () => importBody(file),
    }),
  );
}

/** 白名单筛选只传查询条件，浏览器分页、隐藏列和登录身份不会成为后台导出参数。 */
export async function createExport(
  resource: string,
  filters: Record<string, unknown>,
) {
  const body: components["schemas"]["ExportFilter"] = {
    keyword: typeof filters.keyword === "string" ? filters.keyword : "",
    enabled: typeof filters.enabled === "boolean" ? filters.enabled : null,
    departmentId:
      typeof filters.departmentId === "number" &&
      Number.isSafeInteger(filters.departmentId) &&
      filters.departmentId > 0
        ? filters.departmentId
        : null,
  };
  return unwrapContract(
    await contractClient.POST("/api/bulk/{resource}/exports", {
      params: { path: { resource } },
      body,
    }),
  );
}

/** 服务器固定查询当前登录人的最近作业，不接受由页面指定其他用户归属。 */
export async function listBulkJobs() {
  return unwrapContract(await contractClient.GET("/api/bulk/jobs"));
}

async function saveBulkDownload(
  result: { data?: Blob; error?: unknown; response: Response },
  filename: string,
) {
  if (!result.response.ok || !result.data) {
    const failure = result.error;
    const reason =
      typeof failure === "object" &&
      failure !== null &&
      "message" in failure &&
      typeof failure.message === "string"
        ? failure.message
        : "下载失败，请检查当前权限";
    throw responseError(result.response, reason);
  }
  if (
    !/^text\/csv(?:;|$)/i.test(
      result.response.headers.get("Content-Type") ?? "",
    )
  ) {
    throw new ApiError("文件响应类型异常，请稍后重试", result.response.status);
  }
  const url = URL.createObjectURL(result.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 按资源下载服务器裁剪过字段权限的模板；身份头和会话失效处理复用统一契约客户端。 */
export async function downloadBulkTemplate(resource: string, filename: string) {
  await saveBulkDownload(
    await contractClient.GET("/api/bulk/{resource}/template", {
      params: { path: { resource } },
      parseAs: "blob",
    }),
    filename,
  );
}

/** 下载时重新验证本人归属和当前权限，页面只传作业 ID，不接触服务器存储路径。 */
export async function downloadBulkResult(jobId: number, filename: string) {
  await saveBulkDownload(
    await contractClient.GET("/api/bulk/jobs/{id}/download", {
      params: { path: { id: jobId } },
      parseAs: "blob",
    }),
    filename,
  );
}
