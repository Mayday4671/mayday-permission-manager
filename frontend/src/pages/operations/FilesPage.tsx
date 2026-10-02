import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Upload,
  type UploadFile,
} from "antd";
import { Download, FolderPlus, Folders, UploadCloud } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";
import { DataTable } from "../../components/DataTable";
import { FileImage } from "../../components/FileImage";
import { FormModal } from "../../components/FormModal";
import { RowActions } from "../../components/RowActions";
import { formatTime, QueryState } from "../../components/shared";
import {
  attachmentAccept,
  uploadAttachment,
  downloadAttachment,
} from "../../components/AttachmentUpload";
import { api, jsonBody } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  directoryOptions,
  directoryPath,
  formatFileSize,
  type FileStorageInfo,
} from "../../lib/file-center";
import type { FileDirectory, FileRecord } from "../../types/operations";

type FileAction = "MOVE" | "RECYCLE" | "RESTORE" | "PURGE";
interface DirectoryForm {
  name: string;
  parentId: number;
}
interface UploadForm {
  files: UploadFile[];
  directoryId: number;
}

/**
 * 文件中心：普通列表和回收站共享分页表格，目录、上传和移动均使用业务弹窗。
 * 选择只属于当前页；批量移动不改变所有者，回收文件不能下载，永久删除展示真实清理状态。
 */
export function FilesPage() {
  const { can, session } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [deleted, setDeleted] = useState(false);
  const [directoryId, setDirectoryId] = useState<number>();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [directoryManagerOpen, setDirectoryManagerOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [editingDirectory, setEditingDirectory] =
    useState<FileDirectory | null>(null);
  const [moving, setMoving] = useState<FileRecord[]>([]);
  const [preview, setPreview] = useState<FileRecord | null>(null);
  const [directoryForm] = Form.useForm<DirectoryForm>();
  const [uploadForm] = Form.useForm<UploadForm>();
  const [moveForm] = Form.useForm<{ directoryId: number }>();
  const directories = useQuery({
    queryKey: ["files", "directories"],
    queryFn: ({ signal }) =>
      api<FileDirectory[]>("/operations/files/directories", { signal }),
  });
  const storage = useQuery({
    queryKey: ["files", "storage-info"],
    queryFn: ({ signal }) =>
      api<FileStorageInfo>("/operations/files/storage-info", { signal }),
  });
  const directoryRecords = directories.data ?? [];
  const refresh = () => void client.invalidateQueries({ queryKey: ["files"] });
  const maximumBytes = storage.data?.maximumBytes ?? 10 * 1024 * 1024;

  const editDirectory = (record: FileDirectory | null) => {
    setEditingDirectory(record);
    directoryForm.resetFields();
    directoryForm.setFieldsValue({
      name: record?.name ?? "",
      parentId: record?.parentId ?? directoryId ?? 0,
    });
    setDirectoryOpen(true);
  };
  const move = (records: FileRecord[]) => {
    setMoving(records);
    moveForm.resetFields();
    moveForm.setFieldsValue({ directoryId: records[0]?.directoryId ?? 0 });
  };
  const batch = async (
    action: FileAction,
    rows: FileRecord[],
    targetDirectory?: number,
  ) => {
    await api<{ count: number }>("/operations/files/batch", {
      method: "POST",
      body: jsonBody({
        action,
        ids: rows.map((row) => row.id),
        directoryId: targetDirectory,
      }),
    });
    message.success(
      action === "PURGE" ? "已提交永久清理，将自动刷新结果" : "操作成功",
    );
    refresh();
  };
  const moveOwner = moving[0]?.ownerId;
  const sameOwner = moving.every((file) => file.ownerId === moveOwner);

  return (
    <>
      {directories.error && (
        <Alert
          type="error"
          title="目录加载失败"
          description={directories.error.message}
          action={
            <Button onClick={() => void directories.refetch()}>重试</Button>
          }
        />
      )}
      {storage.error && (
        <Alert
          type="error"
          title="上传配置加载失败"
          description={storage.error.message}
          action={<Button onClick={() => void storage.refetch()}>重试</Button>}
        />
      )}
      <ResourcePage<FileRecord>
        key={deleted ? "recycle" : "active"}
        stateKey={deleted ? "recycle" : "active"}
        resource="files"
        endpoint="/operations/files"
        title="文件中心"
        singular="文件"
        createAllowed={false}
        canEdit={() => false}
        canDelete={() => false}
        fields={() => null}
        queryParams={{ deleted, directoryId }}
        refetchInterval={deleted ? 15_000 : false}
        actionsWidth={156}
        hasExtraFilters={directoryId !== undefined}
        onResetFilters={() => setDirectoryId(undefined)}
        extraFilters={
          <>
            <Segmented
              aria-label="文件列表范围"
              value={deleted ? "recycle" : "active"}
              options={[
                { value: "active", label: "文件" },
                { value: "recycle", label: "回收站" },
              ]}
              onChange={(value) => setDeleted(value === "recycle")}
            />
            <Select
              style={{ width: 180 }}
              aria-label="筛选文件目录"
              placeholder="全部目录"
              allowClear
              showSearch
              optionFilterProp="label"
              value={directoryId}
              options={directoryOptions(directoryRecords)}
              onChange={setDirectoryId}
              loading={directories.isLoading}
            />
          </>
        }
        extraToolbar={
          <>
            <Button
              icon={<Folders size={16} />}
              onClick={() => setDirectoryManagerOpen(true)}
            >
              目录
            </Button>
            {!deleted && can("files:create") && (
              <Button
                type="primary"
                icon={<UploadCloud size={16} />}
                disabled={storage.isLoading || Boolean(storage.error)}
                onClick={() => {
                  uploadForm.resetFields();
                  uploadForm.setFieldsValue({ directoryId: directoryId ?? 0 });
                  setUploadOpen(true);
                }}
              >
                上传文件
              </Button>
            )}
          </>
        }
        columns={[
          {
            title: "文件名称",
            dataIndex: "name",
            width: 260,
            ellipsis: true,
            render: (name: string, record) => (
              <div className="file-center-name">
                {!deleted &&
                  can("files:download") &&
                  /\.(png|jpe?g|webp)$/i.test(name) && (
                    <FileImage file={record} thumbnail />
                  )}
                <Tooltip title={name}>
                  <span>{name}</span>
                </Tooltip>
              </div>
            ),
          },
          {
            title: "目录",
            dataIndex: "directoryId",
            width: 140,
            ellipsis: true,
            render: (value: number | null) =>
              directoryPath(value, directoryRecords),
          },
          {
            title: "大小",
            dataIndex: "size",
            width: 88,
            render: formatFileSize,
          },
          {
            title: "上传人",
            dataIndex: "ownerName",
            width: 96,
            ellipsis: true,
          },
          {
            title: deleted ? "回收时间" : "上传时间",
            dataIndex: deleted ? "deletedAt" : "createdAt",
            width: 156,
            render: formatTime,
          },
          ...(deleted
            ? [
                {
                  title: "清理状态",
                  key: "purge",
                  width: 100,
                  render: (_: unknown, record: FileRecord) =>
                    record.purgeRequestedAt ? (
                      <Tooltip
                        title={
                          record.purgeError ?? "永久清理完成后记录自动移除"
                        }
                      >
                        <Tag color={record.purgeError ? "error" : "processing"}>
                          {record.purgeError ? "等待重试" : "清理中"}
                        </Tag>
                      </Tooltip>
                    ) : (
                      <Tag>可恢复</Tag>
                    ),
                },
              ]
            : []),
        ]}
        canSelect={(record) => !record.purgeRequestedAt}
        batchActions={
          deleted
            ? [
                {
                  key: "restore",
                  label: "批量恢复",
                  permission: "files:restore",
                  run: (rows) => batch("RESTORE", rows),
                },
                {
                  key: "purge",
                  label: "永久删除",
                  permission: "files:purge",
                  danger: true,
                  run: (rows) => batch("PURGE", rows),
                },
              ]
            : [
                {
                  key: "move",
                  label: "批量移动",
                  permission: "files:update",
                  run: async (rows) => move(rows),
                },
                {
                  key: "recycle",
                  label: "移入回收站",
                  permission: "files:delete",
                  danger: true,
                  run: (rows) => batch("RECYCLE", rows),
                },
              ]
        }
        rowActions={(record) =>
          deleted
            ? [
                {
                  key: "restore",
                  label: "恢复",
                  hidden: !can("files:restore"),
                  disabled: Boolean(record.purgeRequestedAt),
                  onClick: () => batch("RESTORE", [record]),
                },
                {
                  key: "purge",
                  label: "永久删除",
                  hidden: !can("files:purge"),
                  disabled: Boolean(record.purgeRequestedAt),
                  danger: true,
                  confirm: {
                    title: "永久删除此文件？",
                    description:
                      "正文清理后无法恢复；被业务引用的文件不能删除。",
                  },
                  onClick: () => batch("PURGE", [record]),
                },
              ]
            : [
                {
                  key: "preview",
                  label: "预览",
                  hidden:
                    !can("files:download") ||
                    !/\.(png|jpe?g|webp)$/i.test(record.name),
                  onClick: () => setPreview(record),
                },
                {
                  key: "download",
                  label: "下载",
                  hidden: !can("files:download"),
                  onClick: () => downloadAttachment(record),
                },
                {
                  key: "move",
                  label: "移动",
                  hidden: !can("files:update"),
                  onClick: () => move([record]),
                },
                {
                  key: "recycle",
                  label: "回收",
                  hidden: !can("files:delete"),
                  danger: true,
                  confirm: {
                    title: "移入回收站？",
                    description:
                      "可在回收站恢复；被内容、通知或审批引用的文件不能回收。",
                  },
                  onClick: () => batch("RECYCLE", [record]),
                },
              ]
        }
      />
      <FormModal
        title="上传文件"
        open={uploadOpen}
        form={uploadForm}
        onCancel={() => setUploadOpen(false)}
        okText="上传"
        onSubmit={async (values) => {
          const file = values.files[0].originFileObj;
          if (!file) throw new Error("请选择文件");
          await uploadAttachment(file, {
            directoryId: values.directoryId,
            maximumBytes,
          });
          setUploadOpen(false);
          refresh();
          message.success("上传成功");
        }}
      >
        <Form.Item
          name="directoryId"
          label="保存目录"
          rules={[{ required: true }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={directoryOptions(directoryRecords, session?.user.id)}
          />
        </Form.Item>
        <Form.Item
          name="files"
          valuePropName="fileList"
          getValueFromEvent={(event: { fileList: UploadFile[] }) =>
            event.fileList
          }
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
            <p className="muted">
              支持文档、图片、压缩包，最大 {formatFileSize(maximumBytes)}
            </p>
          </Upload.Dragger>
        </Form.Item>
      </FormModal>
      <FormModal
        title={`移动 ${moving.length} 个文件`}
        open={moving.length > 0}
        form={moveForm}
        onCancel={() => setMoving([])}
        onSubmit={async (values) => {
          if (!sameOwner) throw new Error("批量移动请选择同一上传人的文件");
          await batch("MOVE", moving, values.directoryId);
          setMoving([]);
        }}
      >
        {!sameOwner && (
          <Alert type="warning" title="请选择同一上传人的文件后再批量移动" />
        )}
        <Form.Item
          name="directoryId"
          label="目标目录"
          rules={[{ required: true }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={directoryOptions(directoryRecords, moveOwner)}
          />
        </Form.Item>
      </FormModal>
      <Modal
        title="文件目录"
        open={directoryManagerOpen}
        centered
        width={760}
        onCancel={() => setDirectoryManagerOpen(false)}
        footer={
          <Button onClick={() => setDirectoryManagerOpen(false)}>关闭</Button>
        }
        destroyOnHidden
      >
        {can("files:create") && (
          <Button
            icon={<FolderPlus size={16} />}
            onClick={() => editDirectory(null)}
            style={{ marginBottom: 12 }}
          >
            新建目录
          </Button>
        )}
        <QueryState
          loading={directories.isLoading}
          error={directories.error}
          retry={() => void directories.refetch()}
        >
          <DataTable<FileDirectory>
            rowKey="id"
            dataSource={directoryRecords}
            pagination={{
              pageSize: 5,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个目录`,
            }}
            columns={[
              {
                title: "目录",
                key: "path",
                width: 240,
                ellipsis: true,
                render: (_, record) =>
                  directoryPath(record.id, directoryRecords),
              },
              { title: "所属用户", dataIndex: "ownerName", width: 110 },
              {
                title: "操作",
                key: "actions",
                width: 160,
                render: (_, record) => (
                  <RowActions
                    label={record.name}
                    actions={[
                      {
                        key: "open",
                        label: "打开",
                        onClick: () => {
                          setDirectoryId(record.id);
                          setDirectoryManagerOpen(false);
                        },
                      },
                      {
                        key: "edit",
                        label: "编辑",
                        hidden: !can("files:update"),
                        onClick: () => editDirectory(record),
                      },
                      {
                        key: "remove",
                        label: "删除",
                        hidden: !can("files:delete"),
                        danger: true,
                        confirm: {
                          title: "删除此目录？",
                          description:
                            "仅能删除不含文件（含回收文件）和子目录的空目录。",
                        },
                        onClick: async () => {
                          await api(
                            `/operations/files/directories/${record.id}?version=${record.version}`,
                            { method: "DELETE" },
                          );
                          if (directoryId === record.id)
                            setDirectoryId(undefined);
                          refresh();
                        },
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        </QueryState>
      </Modal>
      <FormModal
        title={editingDirectory ? "编辑目录" : "新建目录"}
        open={directoryOpen}
        form={directoryForm}
        zIndex={1100}
        onCancel={() => setDirectoryOpen(false)}
        onSubmit={async (values) => {
          await api(
            `/operations/files/directories${editingDirectory ? `/${editingDirectory.id}` : ""}`,
            {
              method: editingDirectory ? "PUT" : "POST",
              body: jsonBody({ ...values, version: editingDirectory?.version }),
            },
          );
          setDirectoryOpen(false);
          refresh();
          message.success("目录已保存");
        }}
      >
        <Form.Item
          name="name"
          label="目录名称"
          rules={[
            { required: true, whitespace: true, message: "请输入目录名称" },
            { max: 100 },
            {
              pattern: /^[^\\/\u0000-\u001f]+$/,
              message: "目录名称不能包含路径或控制字符",
            },
          ]}
        >
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item
          name="parentId"
          label="上级目录"
          rules={[{ required: true }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={directoryOptions(
              directoryRecords.filter(
                (record) => record.id !== editingDirectory?.id,
              ),
              editingDirectory?.ownerId ?? session?.user.id,
            )}
          />
        </Form.Item>
      </FormModal>
      <Modal
        title={preview?.name}
        open={Boolean(preview)}
        centered
        width={880}
        onCancel={() => setPreview(null)}
        destroyOnHidden
        footer={
          <Space>
            <Button
              icon={<Download size={16} />}
              onClick={() =>
                preview &&
                void downloadAttachment(preview).catch((error: Error) =>
                  message.error(error.message),
                )
              }
            >
              下载原文件
            </Button>
            <Button onClick={() => setPreview(null)}>关闭</Button>
          </Space>
        }
      >
        {preview && <FileImage file={preview} />}
      </Modal>
    </>
  );
}
