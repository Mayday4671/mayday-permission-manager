import { App, Button, Upload, type UploadFile } from "antd";
import { UploadCloud } from "lucide-react";
import { api, tokenStore } from "../lib/api";
import type { FileRecord } from "../types/operations";

export const attachmentAccept =
  ".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.zip";
/** 统一前端校验与后端上传。服务器再次校验类型、大小和操作权限，浏览器校验不替代安全边界。 */
export async function uploadAttachment(file: File): Promise<FileRecord> {
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error("文件大小须为 1 字节到 10 MB");
  if (
    !attachmentAccept
      .split(",")
      .some((extension) => file.name.toLowerCase().endsWith(extension))
  )
    throw new Error("不支持此文件类型");
  const body = new FormData();
  body.append("file", file);
  return api<FileRecord>("/operations/files", { method: "POST", body });
}
/** 附件只通过鉴权接口读取，不将令牌拼到下载地址或在新窗口中暴露。 */
export async function downloadAttachment(
  file: Pick<FileRecord, "id" | "name">,
  endpoint = `/operations/files/${file.id}/download`,
) {
  const response = await fetch(`/api${endpoint}`, {
    headers: { Authorization: `Bearer ${tokenStore.get()}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("下载失败，请检查权限或重新登录");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/**
 * 上传组件将服务器文件记录交给表单，失败保留可见错误状态。
 * 移除附件仅移除业务表单中的关联；不擅自永久删除可能被其他内容引用的文件。
 * 业务提交须等待 uploading 消失，再把 response.id 作为关联；后端重新检查文件归属。
 */
export function AttachmentUpload({
  value = [],
  onChange,
  disabled,
  maxCount = 8,
  id,
  accept = attachmentAccept,
  picture = false,
}: {
  value?: UploadFile<FileRecord>[];
  onChange?: (files: UploadFile<FileRecord>[]) => void;
  disabled?: boolean;
  maxCount?: number;
  id?: string;
  accept?: string;
  picture?: boolean;
}) {
  const { message } = App.useApp();
  return (
    <Upload
      id={id}
      fileList={value}
      onChange={(event) => onChange?.(event.fileList)}
      disabled={disabled}
      maxCount={maxCount}
      accept={accept}
      listType={picture ? "picture" : "text"}
      customRequest={async ({ file, onSuccess, onError }) => {
        try {
          onSuccess?.(await uploadAttachment(file as File));
        } catch (error) {
          onError?.(error as Error);
          message.error((error as Error).message);
        }
      }}
      onDownload={(file) => {
        if (file.response)
          void downloadAttachment(file.response).catch((error) =>
            message.error(error.message),
          );
      }}
      showUploadList={{ showDownloadIcon: true }}
    >
      <Button
        icon={<UploadCloud size={16} />}
        disabled={disabled || value.length >= maxCount}
      >
        上传附件
      </Button>
    </Upload>
  );
}
export function attachmentIds(files: UploadFile<FileRecord>[] = []) {
  if (files.some((file) => file.status === "uploading"))
    throw new Error("附件正在上传，请稍候再提交");
  if (files.some((file) => file.status === "error" || !file.response?.id))
    throw new Error("请重试或移除上传失败的附件");
  return files.map((file) => file.response!.id);
}
