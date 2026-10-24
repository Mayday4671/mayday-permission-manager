import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Image,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import { api, tokenStore } from "../../lib/api";
interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}
interface TelegramArchiveEntry {
  name: string;
  size: number;
  modifiedAt: number;
  withinExtractionLimit: boolean;
  encrypted: boolean;
}

/** Lists archive contents on demand and fetches one bounded entry only after selection. */
export function TelegramArchiveBrowser({ mediaId }: { mediaId: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TelegramArchiveEntry>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const entries = useQuery({
    queryKey: ["telegram", "archive-entries", mediaId, page],
    queryFn: () =>
      api<PageResult<TelegramArchiveEntry>>(
        `/telegram/media/${mediaId}/archive-entries?page=${page}&size=50`,
      ),
    enabled: open,
    retry: false,
  });

  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreviewUrl(undefined);
    setPreviewError(undefined);
    const token = tokenStore.get();
    const url = `/api/telegram/media/${mediaId}/archive-entry?name=${encodeURIComponent(selected.name)}`;
    void fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("无法读取所选条目，请检查文件状态和读取权限");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.size !== selected.size)
          throw new Error("条目内容不完整，请重试");
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setPreviewError(
            error.name === "TimeoutError"
              ? "条目读取超时，请重试"
              : error.message,
          );
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId, open, selected, previewAttempt]);

  const close = () => {
    setOpen(false);
    setSelected(undefined);
    setPreviewUrl(undefined);
  };

  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        浏览压缩包
      </Button>
      <Modal
        title="压缩包内容"
        open={open}
        onCancel={close}
        footer={<Button onClick={close}>关闭</Button>}
        width={760}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          支持 ZIP、RAR 与
          7z。加密条目、符号链接和超出单文件上限的条目不可提取；原归档路径不会写入服务器目录。
        </Typography.Paragraph>
        {entries.error ? (
          <Alert type="error" showIcon message={entries.error.message} />
        ) : null}
        <Table<TelegramArchiveEntry>
          rowKey="name"
          size="small"
          loading={entries.isLoading}
          dataSource={entries.data?.items ?? []}
          pagination={{
            current: page,
            pageSize: 50,
            total: entries.data?.total ?? 0,
            showSizeChanger: false,
            onChange: (nextPage) => {
              setPage(nextPage);
              setSelected(undefined);
              setPreviewUrl(undefined);
            },
          }}
          columns={[
            { title: "文件路径", dataIndex: "name", ellipsis: true },
            {
              title: "大小",
              dataIndex: "size",
              width: 110,
              render: (value: number) => `${(value / 1024).toFixed(1)} KB`,
            },
            {
              title: "操作",
              width: 150,
              render: (_value, entry) => (
                <Space>
                  {entry.encrypted ? <Tag color="warning">加密</Tag> : null}
                  <Button
                    type="link"
                    size="small"
                    disabled={!entry.withinExtractionLimit}
                    onClick={() => {
                      setPreviewUrl(undefined);
                      setSelected(entry);
                    }}
                  >
                    预览 / 提取
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        {selected ? (
          <Card size="small" title={selected.name} style={{ marginTop: 16 }}>
            {previewError ? (
              <Alert
                type="error"
                showIcon
                title={previewError}
                action={
                  <Button
                    onClick={() => setPreviewAttempt((value) => value + 1)}
                  >
                    重新读取
                  </Button>
                }
              />
            ) : !previewUrl ? (
              <Typography.Text type="secondary">
                正在按需读取所选条目…
              </Typography.Text>
            ) : selected.name.match(/\.(png|jpe?g|gif|webp)$/i) ? (
              <Image
                src={previewUrl}
                alt={selected.name}
                style={{ maxWidth: "100%" }}
              />
            ) : selected.name.match(/\.mp4$/i) ? (
              <video
                controls
                preload="metadata"
                src={previewUrl}
                style={{ maxWidth: "100%" }}
              />
            ) : (
              <a
                href={previewUrl}
                download={selected.name.split("/").at(-1) ?? "archive-entry"}
              >
                下载所选文件
              </a>
            )}
          </Card>
        ) : null}
      </Modal>
    </>
  );
}
