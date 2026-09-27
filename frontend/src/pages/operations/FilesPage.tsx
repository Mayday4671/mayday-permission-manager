import { useState } from "react";
import { App, Button, Form, Upload, type UploadFile } from "antd";
import { UploadCloud, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";
import { FormModal } from "../../components/FormModal";
import { formatTime } from "../../components/shared";
import {
  attachmentAccept,
  uploadAttachment,
  downloadAttachment,
} from "../../components/AttachmentUpload";
import { useAuth } from "../../lib/auth";
import type { FileRecord } from "../../types/operations";

/** 文件中心复用业务附件的上传校验与下载逻辑；选择文件后只有点击“上传”才开始保存。 */
export function FilesPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ files: UploadFile[] }>();
  return (
    <>
      <ResourcePage<FileRecord>
        resource="files"
        endpoint="/operations/files"
        title="文件中心"
        singular="文件"
        createAllowed={false}
        canEdit={() => false}
        fields={() => null}
        actionsWidth={100}
        extraToolbar={
          can("files:create") && (
            <Button
              type="primary"
              icon={<UploadCloud size={16} />}
              onClick={() => setOpen(true)}
            >
              上传文件
            </Button>
          )
        }
        columns={[
          { title: "文件名称", dataIndex: "name", width: 216, ellipsis: true },
          {
            title: "大小",
            dataIndex: "size",
            width: 88,
            render: (v) =>
              v < 1024
                ? v + " B"
                : v < 1048576
                  ? (v / 1024).toFixed(1) + " KB"
                  : (v / 1048576).toFixed(1) + " MB",
          },
          {
            title: "上传人",
            dataIndex: "ownerName",
            width: 96,
            ellipsis: true,
          },
          {
            title: "上传时间",
            dataIndex: "createdAt",
            width: 156,
            render: formatTime,
          },
        ]}
        extraActions={(r) =>
          can("files:download") && (
            <Button
              type="text"
              aria-label="下载文件"
              icon={<Download size={15} />}
              onClick={() =>
                void downloadAttachment(r).catch((error) =>
                  message.error(error.message),
                )
              }
            />
          )
        }
      />
      <FormModal
        title="上传文件"
        open={open}
        form={form}
        onCancel={() => setOpen(false)}
        okText="上传"
        onSubmit={async (values) => {
          const file = values.files[0].originFileObj;
          if (!file) throw new Error("请选择文件");
          await uploadAttachment(file);
          setOpen(false);
          void client.invalidateQueries({ queryKey: ["files"] });
          message.success("上传成功");
        }}
      >
        <Form.Item
          name="files"
          valuePropName="fileList"
          getValueFromEvent={(e) => e.fileList}
          rules={[
            { required: true, type: "array", min: 1, message: "请选择文件" },
          ]}
        >
          <Upload.Dragger
            maxCount={1}
            beforeUpload={() => false}
            accept={attachmentAccept}
          >
            <UploadCloud size={32} />
            <p>点击选择或拖入文件</p>
            <p className="muted">支持文档、图片、压缩包，最大 10 MB</p>
          </Upload.Dragger>
        </Form.Item>
      </FormModal>
    </>
  );
}
