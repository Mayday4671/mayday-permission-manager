import { App, Button, Space } from "antd";
import { Download } from "lucide-react";
import { downloadAttachment } from "./AttachmentUpload";
import type { FileRecord } from "../types/operations";

/** 业务决定下载地址，展示组件不把文件中心权限与业务附件权限混为一谈。每次点击由服务端重新鉴权。 */
export function AttachmentList({
  files,
  endpoint,
}: {
  files: FileRecord[];
  endpoint: (file: FileRecord) => string;
}) {
  const { message } = App.useApp();
  return (
    files.length > 0 && (
      <Space orientation="vertical" className="attachment-list">
        {files.map((file) => (
          <Button
            key={file.id}
            type="link"
            icon={<Download size={14} />}
            onClick={() =>
              void downloadAttachment(file, endpoint(file)).catch((error) =>
                message.error(error.message),
              )
            }
          >
            {file.name}
          </Button>
        ))}
      </Space>
    )
  );
}
