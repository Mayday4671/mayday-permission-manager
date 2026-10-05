import { useEffect, useState } from "react";
import {
  App,
  Button,
  Modal,
  Progress,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import { Download, FileUp, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import {
  commitImport,
  controlBulkJob,
  createExport,
  downloadBulkResult,
  downloadBulkTemplate,
  listBulkJobs,
  previewImport,
  type BulkJob,
  type ImportPreview,
  type ImportRow,
} from "../lib/bulk-data";
import { downloadText } from "../lib/table-output";
import { csvCell } from "../lib/export";
import { DataTable } from "./DataTable";
import { formatTime } from "./shared";

const statuses = {
  QUEUED: "排队中",
  RUNNING: "导出中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

/** 通用导入预览、原子提交、错误清单与异步导出进度；只为显式注册的业务资源启用。 */
export function BulkDataTools({
  resource,
  title,
  filters,
  onImported,
}: {
  resource: string;
  title: string;
  filters: Record<string, unknown>;
  onImported: () => void;
}) {
  const { can, session } = useAuth();
  const { message } = App.useApp();
  const [importOpen, setImportOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [controlling, setControlling] = useState<number | null>(null);
  const [exportKey, setExportKey] = useState(crypto.randomUUID());
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [previewSize, setPreviewSize] = useState(5);
  const importAllowed =
    can(`${resource}:import`) &&
    can(`${resource}:create`) &&
    session?.dataScopes[resource] === "ALL";
  const exportAllowed = can(`${resource}:export`) && can(`${resource}:view`);
  const jobs = useQuery({
    queryKey: ["bulk-jobs", session?.user.id],
    queryFn: listBulkJobs,
    enabled: jobsOpen,
    refetchInterval: (query) =>
      query.state.data?.some((job) =>
        ["QUEUED", "RUNNING"].includes(job.status),
      )
        ? 1500
        : false,
  });
  useEffect(() => {
    const resize = () =>
      setPreviewSize(
        window.innerWidth < 640
          ? Math.max(
              1,
              Math.min(3, Math.floor((window.innerHeight - 380) / 170)),
            )
          : Math.max(
              3,
              Math.min(8, Math.floor((window.innerHeight - 380) / 64)),
            ),
      );
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const reset = () => {
    setFile(null);
    setPreview(null);
    setIdempotencyKey("");
  };
  const startExport = async () => {
    setExporting(true);
    try {
      await createExport(resource, filters, exportKey);
      setExportKey(crypto.randomUUID());
      setJobsOpen(true);
      void jobs.refetch();
      message.success("导出任务已创建");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      {importAllowed && (
        <Button
          icon={<FileUp size={15} />}
          onClick={() => {
            reset();
            setImportOpen(true);
          }}
        >
          导入
        </Button>
      )}
      {exportAllowed && (
        <Button
          icon={<Download size={15} />}
          loading={exporting}
          onClick={() => void startExport()}
        >
          导出
        </Button>
      )}
      {(importAllowed || exportAllowed) && (
        <Tooltip title="批量作业记录">
          <Button
            aria-label="批量作业记录"
            icon={<ListChecks size={15} />}
            onClick={() => setJobsOpen(true)}
          />
        </Tooltip>
      )}
      <Modal
        title={`导入${title}`}
        open={importOpen}
        centered
        width={920}
        rootClassName="business-form-modal"
        classNames={{
          container: "form-modal-container",
          header: "form-modal-header",
          body: "form-modal-body",
          footer: "form-modal-footer",
        }}
        style={{ maxWidth: "calc(100vw - 32px)" }}
        mask={{ closable: false }}
        keyboard={!busy}
        closable={{ disabled: busy }}
        onCancel={() => setImportOpen(false)}
        afterClose={reset}
        footer={
          <Space>
            <Button disabled={busy} onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={
                !file ||
                !preview ||
                preview.totalRows !== preview.validRows ||
                !importAllowed
              }
              onClick={async () => {
                if (!file || !preview || busy) return;
                setBusy(true);
                try {
                  const result = await commitImport(
                    resource,
                    file,
                    idempotencyKey,
                  );
                  message.success(`已导入 ${result.importedRows} 条`);
                  setImportOpen(false);
                  onImported();
                } catch (error) {
                  message.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认导入
            </Button>
          </Space>
        }
      >
        <div className="bulk-import-toolbar">
          <Button
            disabled={busy}
            onClick={() =>
              void downloadBulkTemplate(
                resource,
                `${title}-导入模板.csv`,
              ).catch((error) => message.error((error as Error).message))
            }
          >
            下载模板
          </Button>
          <Upload
            accept=".csv"
            showUploadList={false}
            disabled={busy}
            beforeUpload={(selected) => {
              if (!selected.size || selected.size > 2 * 1024 * 1024) {
                message.error("请选择 1 字节到 2 MB 的 UTF-8 CSV 文件");
                return false;
              }
              setFile(selected);
              setPreview(null);
              setIdempotencyKey(crypto.randomUUID());
              return false;
            }}
          >
            <Button disabled={busy}>选择 CSV</Button>
          </Upload>
          <Button
            loading={busy}
            disabled={!file}
            onClick={async () => {
              if (!file || busy) return;
              setBusy(true);
              try {
                setPreview(await previewImport(resource, file));
              } catch (error) {
                setPreview(null);
                message.error((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            预览校验
          </Button>
          <span className="muted">
            {file?.name ?? "单次最多 1000 行，多个角色或岗位 ID 用分号分隔"}
          </span>
        </div>
        <p className="muted">
          只创建新账号；账号、密码和权限全部由服务器校验。任何错误都会阻止整批提交，密码不会出现在预览或错误文件中。
        </p>
        {preview && (
          <>
            <div className="bulk-import-summary">
              <span>共 {preview.totalRows} 行</span>
              <span>通过 {preview.validRows} 行</span>
              <span
                className={
                  preview.validRows === preview.totalRows
                    ? ""
                    : "bulk-row-errors"
                }
              >
                错误 {preview.totalRows - preview.validRows} 行
              </span>
              {preview.totalRows !== preview.validRows && (
                <Button
                  size="small"
                  onClick={() => {
                    const headers = ["行号", "用户名", "姓名", "错误说明"];
                    const rows = preview.rows
                      .filter((row) => row.errors.length)
                      .map((row) => [
                        row.rowNumber,
                        row.values.username,
                        row.values.nickname,
                        row.errors.join("；"),
                      ]);
                    downloadText(
                      `${title}-导入错误.csv`,
                      [headers, ...rows]
                        .map((row) => row.map(csvCell).join(","))
                        .join("\r\n"),
                    );
                  }}
                >
                  下载错误清单
                </Button>
              )}
            </div>
            <DataTable<ImportRow>
              rowKey="rowNumber"
              size="small"
              dataSource={preview.rows}
              sequence={(row) => row.rowNumber}
              pagination={{
                defaultPageSize: previewSize,
                pageSize: previewSize,
                showTotal: (total) => `共 ${total} 行`,
                showSizeChanger: false,
              }}
              columns={[
                {
                  title: "用户名",
                  dataIndex: ["values", "username"],
                  width: 160,
                },
                {
                  title: "姓名",
                  dataIndex: ["values", "nickname"],
                  width: 160,
                },
                {
                  title: "初始密码",
                  dataIndex: ["values", "password"],
                  width: 96,
                },
                {
                  title: "校验结果",
                  key: "errors",
                  width: 400,
                  render: (_, row) =>
                    row.errors.length ? (
                      <Tooltip title={row.errors.join("；")}>
                        <span className="bulk-row-errors">
                          {row.errors.join("；")}
                        </span>
                      </Tooltip>
                    ) : (
                      <Tag color="success">通过</Tag>
                    ),
                },
              ]}
            />
          </>
        )}
      </Modal>
      <Modal
        title="批量作业记录"
        open={jobsOpen}
        onCancel={() => setJobsOpen(false)}
        centered
        width={980}
        rootClassName="business-form-modal"
        classNames={{
          container: "form-modal-container",
          header: "form-modal-header",
          body: "form-modal-body",
          footer: "form-modal-footer",
        }}
        style={{ maxWidth: "calc(100vw - 32px)" }}
        footer={<Button onClick={() => setJobsOpen(false)}>关闭</Button>}
      >
        {jobs.error && (
          <p className="bulk-row-errors">{(jobs.error as Error).message}</p>
        )}
        <DataTable<BulkJob>
          rowKey="id"
          size="small"
          loading={jobs.isLoading}
          dataSource={jobs.data ?? []}
          pagination={{
            pageSize: previewSize,
            showSizeChanger: false,
            showTotal: (total) => `最近 ${total} 项作业`,
          }}
          columns={[
            {
              title: "业务",
              key: "resource",
              width: 110,
              render: (_, job) =>
                job.resource === "users" ? "用户" : job.resource,
            },
            {
              title: "类型",
              dataIndex: "kind",
              width: 90,
              render: (kind: string) => (kind === "IMPORT" ? "导入" : "导出"),
            },
            {
              title: "状态 / 进度",
              key: "progress",
              width: 220,
              render: (_, job) => (
                <div>
                  <Tag
                    color={
                      job.status === "FAILED"
                        ? "error"
                        : job.status === "SUCCEEDED"
                          ? "success"
                          : "processing"
                    }
                  >
                    {statuses[job.status]}
                  </Tag>
                  <span>
                    {job.processedRows}
                    {job.totalRows ? ` / ${job.totalRows}` : ""} 条
                  </span>
                  {job.status === "RUNNING" && (
                    <Progress
                      size="small"
                      percent={
                        job.totalRows
                          ? Math.round(
                              (job.processedRows / job.totalRows) * 100,
                            )
                          : 0
                      }
                      showInfo={false}
                    />
                  )}
                </div>
              ),
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              width: 170,
              render: formatTime,
            },
            {
              title: "说明",
              dataIndex: "failure",
              width: 210,
              render: (failure: BulkJob["failure"]) =>
                failure ?? "24 小时内有效",
            },
            {
              title: "操作",
              key: "actions",
              width: 150,
              render: (_, job) =>
                job.kind === "EXPORT" && job.status === "SUCCEEDED" ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() =>
                      void downloadBulkResult(
                        job.id,
                        `${job.resource}-${job.id}.csv`,
                      ).catch((error) =>
                        message.error((error as Error).message),
                      )
                    }
                  >
                    下载
                  </Button>
                ) : job.kind === "EXPORT" ? (
                  <Popconfirm
                    title={
                      ["QUEUED", "RUNNING"].includes(job.status)
                        ? "取消此导出作业？"
                        : "重新执行此导出作业？"
                    }
                    onConfirm={async () => {
                      if (controlling !== null) return;
                      setControlling(job.id);
                      try {
                        await controlBulkJob(
                          job.id,
                          ["QUEUED", "RUNNING"].includes(job.status)
                            ? "cancel"
                            : "retry",
                        );
                        await jobs.refetch();
                        message.success("作业状态已更新");
                      } catch (error) {
                        message.error((error as Error).message);
                      } finally {
                        setControlling(null);
                      }
                    }}
                  >
                    <Button
                      type="link"
                      size="small"
                      disabled={controlling !== null}
                      loading={controlling === job.id}
                    >
                      {["QUEUED", "RUNNING"].includes(job.status)
                        ? "取消"
                        : "重试"}
                    </Button>
                  </Popconfirm>
                ) : null,
            },
          ]}
        />
      </Modal>
    </>
  );
}
