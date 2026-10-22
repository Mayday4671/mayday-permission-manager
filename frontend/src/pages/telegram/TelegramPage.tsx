import { useEffect, useRef, useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Image,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  DisconnectOutlined,
  LockOutlined,
  LoginOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Radio, Select } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, tokenStore } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";
import dayjs, { type Dayjs } from "dayjs";
import Hls from "hls.js";

interface TelegramSearch {
  id: number;
  keyword: string;
  botUsername: string;
  status: string;
  parseStatus: string;
  statusMessage: string;
  createdAt: string;
  expiresAt: string;
}

interface TelegramMessage {
  id: number;
  telegramMessageId: string;
  senderId: string | null;
  outgoing: boolean;
  updateType: string;
  contentType: string;
  messageText: string | null;
  entitiesJson: string;
  replyMarkupJson: string;
  replyToMessageId: string | null;
  telegramSentAt: string | null;
  telegramEditedAt: string | null;
  associationStatus: string;
}

interface TelegramSourceLink {
  sourceMessageId: number;
  url: string;
  host: string;
  sourceType: string;
  publicChat: string | null;
}

interface ParsedTelegramMessage {
  id: number;
  telegramMessageId: string;
  messageText: string | null;
  sourceLinks: TelegramSourceLink[];
  telegramSentAt: string | null;
  telegramEditedAt: string | null;
}

interface TelegramCollectionTask {
  id: number;
  messageLink: string | null;
  sourceTitle: string | null;
  fromDate: string | null;
  toDate: string | null;
  status: string;
  statusMessage: string;
  maxMessages: number;
  collectedMessages: number;
  scannedMessages: number;
  trackingEnabled: boolean;
  liveCheckedAt: string | null;
  liveStatusMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TelegramChannelOption {
  chatId: string;
  title: string;
  username: string | null;
}

interface TelegramCollectedMessage {
  id: number;
  telegramMessageId: string;
  senderId: string | null;
  contentType: string | null;
  messageText: string | null;
  canBeSaved: boolean;
  albumId: string | null;
  topicId: string | null;
  metadataJson: string;
  telegramSentAt: string | null;
  telegramEditedAt: string | null;
  media: TelegramCollectedMedia[];
}

interface TelegramCollectedMedia {
  id: number;
  kind: string;
  fileName: string | null;
  expectedSize: number | null;
  actualSize: number | null;
  mediaType: string | null;
  status: string;
  contentUrl: string | null;
  failureMessage: string | null;
}

interface TelegramVideoPreviewStatus {
  id: number;
  mediaId: number;
  status: string;
  statusMessage: string;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  transcoded: boolean | null;
  manifestUrl: string | null;
  updatedAt: string;
}

/** HLS 资源需要带后台 Bearer 会话；只允许从当前站点加载清单和分片。 */
function AuthenticatedHlsVideo({
  manifestUrl,
  mediaId,
}: {
  manifestUrl: string;
  mediaId: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const [originalUrl, setOriginalUrl] = useState<string>();
  const [ticketPending, setTicketPending] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!Hls.isSupported()) {
      setError("当前浏览器未提供受支持的安全 HLS 播放能力");
      return;
    }

    const player = new Hls({
      xhrSetup: (request, url) => {
        const target = new URL(url, window.location.href);
        if (target.origin !== window.location.origin) {
          request.abort();
          return;
        }
        const token = tokenStore.get();
        if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
      },
    });
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setError("视频播放失败；请刷新任务状态后重试");
    });
    player.loadSource(manifestUrl);
    player.attachMedia(element);
    return () => player.destroy();
  }, [manifestUrl]);

  const openOriginal = async () => {
    setTicketPending(true);
    try {
      const ticket = await api<{ url: string }>(
        `/telegram/media/${mediaId}/stream-ticket`,
        { method: "POST" },
      );
      setOriginalUrl(ticket.url);
    } catch (ticketError) {
      setError(
        ticketError instanceof Error
          ? ticketError.message
          : "无法创建受权原视频访问链接",
      );
    } finally {
      setTicketPending(false);
    }
  };

  return (
    <Space direction="vertical" size={4}>
      <video ref={video} controls preload="metadata" width={240} />
      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
      {originalUrl ? (
        <a href={originalUrl} target="_blank" rel="noopener noreferrer">
          在新窗口打开原视频
        </a>
      ) : (
        <Button
          size="small"
          loading={ticketPending}
          onClick={() => void openOriginal()}
        >
          获取受权原视频链接
        </Button>
      )}
    </Space>
  );
}

/** Loads protected media with the current session token and revokes each temporary browser URL on unmount. */
function TelegramMediaPreview({
  attachment,
}: {
  attachment: TelegramCollectedMedia;
}) {
  const [source, setSource] = useState<string>();
  const [previewRequested, setPreviewRequested] = useState(false);
  const queryClient = useQueryClient();
  const previewKey = ["telegram", "video-preview", attachment.id];
  const videoPreview = useQuery({
    queryKey: previewKey,
    queryFn: () =>
      api<TelegramVideoPreviewStatus>(
        `/telegram/media/${attachment.id}/video-preview`,
      ),
    enabled: previewRequested,
    refetchInterval: (query) =>
      ["QUEUED", "PROCESSING"].includes(query.state.data?.status ?? "")
        ? 1500
        : false,
    retry: false,
  });
  const requestPreview = useMutation({
    mutationFn: () =>
      api<TelegramVideoPreviewStatus>(
        `/telegram/media/${attachment.id}/video-preview`,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      setPreviewRequested(true);
      queryClient.setQueryData(previewKey, result);
    },
  });
  const cancelPreview = useMutation({
    mutationFn: () =>
      api<TelegramVideoPreviewStatus>(
        `/telegram/media/${attachment.id}/video-preview/cancel`,
        { method: "POST" },
      ),
    onSuccess: (result) => queryClient.setQueryData(previewKey, result),
  });

  useEffect(() => {
    if (
      !attachment.contentUrl ||
      attachment.mediaType === "video/mp4" ||
      attachment.mediaType === "video/webm"
    )
      return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const token = tokenStore.get();
    void fetch(attachment.contentUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("附件尚不可读取");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => setSource(undefined));
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.contentUrl]);

  if (!attachment.contentUrl) return null;
  if (
    attachment.mediaType === "video/mp4" ||
    attachment.mediaType === "video/webm"
  ) {
    const task = videoPreview.data;
    if (task?.status === "READY" && task.manifestUrl) {
      return (
        <AuthenticatedHlsVideo
          manifestUrl={task.manifestUrl}
          mediaId={attachment.id}
        />
      );
    }
    if (["QUEUED", "PROCESSING"].includes(task?.status ?? "")) {
      return (
        <Space direction="vertical" size={2}>
          <Typography.Text type="secondary">
            {task?.statusMessage}
          </Typography.Text>
          <Button
            size="small"
            onClick={() => cancelPreview.mutate()}
            loading={cancelPreview.isPending}
          >
            取消预览
          </Button>
        </Space>
      );
    }
    return (
      <Space direction="vertical" size={2}>
        <Button
          size="small"
          loading={requestPreview.isPending}
          onClick={() => requestPreview.mutate()}
        >
          生成安全预览
        </Button>
        {task?.statusMessage ? (
          <Typography.Text type="secondary">
            {task.statusMessage}
          </Typography.Text>
        ) : null}
        {requestPreview.error || videoPreview.error ? (
          <Typography.Text type="danger">
            {(requestPreview.error ?? videoPreview.error)?.message}
          </Typography.Text>
        ) : null}
        {["FAILED", "EXPIRED", "CANCELLED"].includes(task?.status ?? "") ? (
          <Button
            size="small"
            type="link"
            onClick={() => requestPreview.mutate()}
          >
            重新生成
          </Button>
        ) : null}
      </Space>
    );
  }
  if (!source)
    return <Typography.Text type="secondary">正在读取附件…</Typography.Text>;
  if (attachment.mediaType?.startsWith("image/")) {
    return (
      <Image
        width={76}
        height={60}
        style={{ objectFit: "cover", borderRadius: 6 }}
        src={source}
        alt={attachment.fileName ?? "Telegram 图片"}
      />
    );
  }
  return (
    <a href={source} download={attachment.fileName ?? "telegram-media"}>
      下载附件
    </a>
  );
}

interface InlineButton {
  text: string;
  type: string;
  url?: string;
}

interface CallbackAnswer {
  text: string;
  showAlert: boolean;
  url: string | null;
}

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
function TelegramArchiveBrowser({ mediaId }: { mediaId: number }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TelegramArchiveEntry>();
  const [previewUrl, setPreviewUrl] = useState<string>();
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
    const token = tokenStore.get();
    const url = `/api/telegram/media/${mediaId}/archive-entry?name=${encodeURIComponent(selected.name)}`;
    void fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法安全读取所选压缩包条目");
        objectUrl = URL.createObjectURL(await response.blob());
        setPreviewUrl(objectUrl);
      })
      .catch(() => setPreviewUrl(undefined));
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId, open, selected]);

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
            {!previewUrl ? (
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

interface TelegramStatus {
  enabled: boolean;
  credentialsConfigured: boolean;
  encryptionKeyConfigured: boolean;
  proxyEnabled: boolean;
  proxyConfigured: boolean;
  proxyType: string;
  archiveToolAvailable: boolean;
  videoPreviewToolsAvailable: boolean;
  accountConfigured: boolean;
  connected: boolean;
  state: string;
  message: string;
  maskedPhoneNumber: string | null;
  telegramUserId: string | null;
}

type Challenge = {
  endpoint: string;
  label: string;
  placeholder: string;
  password?: boolean;
};

const CHALLENGES: Record<string, Challenge> = {
  WAITING_FOR_PHONE: {
    endpoint: "/session/phone",
    label: "手机号",
    placeholder: "国际区号格式，例如 +8613800000000",
  },
  WAITING_FOR_CODE: {
    endpoint: "/session/code",
    label: "登录验证码",
    placeholder: "输入 Telegram 客户端收到的验证码",
  },
  WAITING_FOR_PASSWORD: {
    endpoint: "/session/password",
    label: "两步验证密码",
    placeholder: "输入 Telegram 两步验证密码",
    password: true,
  },
  WAITING_FOR_EMAIL_ADDRESS: {
    endpoint: "/session/email",
    label: "邮箱地址",
    placeholder: "输入 Telegram 要求验证的邮箱地址",
  },
  WAITING_FOR_EMAIL_CODE: {
    endpoint: "/session/email-code",
    label: "邮箱验证码",
    placeholder: "输入 Telegram 邮箱验证码",
  },
};

const STATE_LABELS: Record<string, string> = {
  NOT_CONNECTED: "未连接",
  INITIALIZING: "正在初始化",
  WAITING_FOR_PHONE: "等待手机号",
  WAITING_FOR_CODE: "等待验证码",
  WAITING_FOR_PASSWORD: "等待两步验证",
  WAITING_FOR_EMAIL_ADDRESS: "等待邮箱",
  WAITING_FOR_EMAIL_CODE: "等待邮箱验证码",
  WAITING_FOR_REGISTRATION: "等待完善资料",
  WAITING_FOR_DEVICE_CONFIRMATION: "等待设备确认",
  READY: "已授权并连接",
  CLOSING: "正在安全关闭",
  CLOSED: "连接已关闭，会话已保留",
  LOGGED_OUT: "账号已退出",
  ERROR: "连接异常",
  UNSUPPORTED: "需要其他授权步骤",
};

/** Converts only the backend's documented fixed search states to concise labels. */
function searchStatusLabel(state: string): string {
  const labels: Record<string, string> = {
    PENDING: "准备发送",
    SENDING: "发送中",
    WAITING: "等待回复",
    COMPLETED: "已收到回复",
    TIMEOUT: "等待超时",
    FAILED: "失败",
    CANCELLED: "已取消",
  };
  return labels[state] ?? "状态未知";
}

/** Parses only the server's allow-listed, non-secret inline button projection. */
function inlineKeyboard(markup: string): InlineButton[][] {
  try {
    const parsed: unknown = JSON.parse(markup);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) =>
      Array.isArray(row)
        ? row.filter((button): button is InlineButton =>
            Boolean(
              button &&
              typeof button === "object" &&
              typeof button.text === "string" &&
              typeof button.type === "string" &&
              (button.type !== "URL" || isSafeHttpsUrl(button.url)),
            ),
          )
        : [],
    );
  } catch {
    return [];
  }
}

/** Exposes only HTTPS links from untrusted bot messages as clickable anchors. */
function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Presents the owner-scoped Telegram login lifecycle without persisting any challenge input in the browser. */
export function TelegramPage() {
  const { message, modal } = App.useApp();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [collectionSource, setCollectionSource] = useState<"link" | "channel">(
    "link",
  );
  const [messageLink, setMessageLink] = useState("");
  const [channelSearchText, setChannelSearchText] = useState("");
  const [channelQuery, setChannelQuery] = useState("");
  const [channelId, setChannelId] = useState<string>();
  const [collectionDateRange, setCollectionDateRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null);
  const [maxMessages, setMaxMessages] = useState(100);
  const [downloadImages, setDownloadImages] = useState(false);
  const [downloadVideos, setDownloadVideos] = useState(false);
  const [downloadDocuments, setDownloadDocuments] = useState(false);
  const [selectedCollection, setSelectedCollection] =
    useState<TelegramCollectionTask | null>(null);
  const [collectionTaskPage, setCollectionTaskPage] = useState(1);
  const [collectionPage, setCollectionPage] = useState(1);
  const [messageSearch, setMessageSearch] = useState<TelegramSearch | null>(
    null,
  );
  const [messagePage, setMessagePage] = useState(1);
  const [parsedMessagePage, setParsedMessagePage] = useState(1);
  const [searchPage, setSearchPage] = useState(1);

  /** Runs callbacks only by pointing to a button already captured from this search. */
  const callback = useMutation({
    mutationFn: ({
      searchId,
      messageId,
      row,
      column,
    }: {
      searchId: number;
      messageId: number;
      row: number;
      column: number;
    }) =>
      api<CallbackAnswer>(
        `/telegram/searches/${searchId}/messages/${messageId}/buttons/${row}/${column}`,
        { method: "POST" },
      ),
    onSuccess: async (answer) => {
      message.info(answer.text || "机器人已处理按钮请求");
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "search-messages", messageSearch?.id],
      });
    },
    onError: (error: Error) => message.error(error.message),
  });

  const status = useQuery({
    queryKey: ["telegram", "status"],
    queryFn: () => api<TelegramStatus>("/telegram/status"),
    retry: false,
    refetchInterval: 2500,
  });

  const action = useMutation({
    mutationFn: async (request: {
      endpoint: string;
      value?: string;
      body?: Record<string, string>;
    }) =>
      api<TelegramStatus>(`/telegram${request.endpoint}`, {
        method: "POST",
        ...(request.value !== undefined
          ? { body: JSON.stringify({ value: request.value }) }
          : request.body
            ? { body: JSON.stringify(request.body) }
            : {}),
      }),
    onSuccess: async (next) => {
      setValue("");
      setFirstName("");
      setLastName("");
      queryClient.setQueryData(["telegram", "status"], next);
      await queryClient.invalidateQueries({ queryKey: ["telegram", "status"] });
      message.success(next.message);
    },
    onError: (error: Error) => message.error(error.message),
  });

  const view = status.data;
  const challenge = view ? CHALLENGES[view.state] : undefined;
  const canConnect = can("telegram:connect");
  const canClose = can("telegram:disconnect");
  const canLogOut = can("telegram:logout");
  const isBusy = action.isPending;

  /** Debounces account chat lookups so each keystroke does not create a TDLib search. */
  useEffect(() => {
    if (collectionSource !== "channel") return;
    const timer = window.setTimeout(
      () => setChannelQuery(channelSearchText),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [channelSearchText, collectionSource]);

  /** Offers only chats already known to the connected account; it never joins a channel. */
  const collectionChannels = useQuery({
    queryKey: ["telegram", "collection-channels", channelQuery.trim()],
    queryFn: () =>
      api<TelegramChannelOption[]>(
        `/telegram/collections/channels?query=${encodeURIComponent(channelQuery.trim())}&size=20`,
      ),
    enabled: Boolean(
      collectionSource === "channel" &&
      channelQuery.trim().length >= 2 &&
      view?.state === "READY" &&
      can("telegram:collect"),
    ),
    retry: false,
    staleTime: 15_000,
  });

  /** Keeps search history server-paged and scoped to the current authorized user. */
  const searchHistory = useQuery({
    queryKey: ["telegram", "searches", searchPage],
    queryFn: () =>
      api<PageResult<TelegramSearch>>(
        `/telegram/searches?page=${searchPage}&size=20`,
      ),
    enabled: Boolean(view && can("telegram:view")),
    refetchInterval: 3000,
    retry: false,
  });

  /** Shows durable, owner-scoped history tasks and refreshes only while work remains. */
  const collectionTasks = useQuery({
    queryKey: ["telegram", "collections", collectionTaskPage],
    queryFn: () =>
      api<PageResult<TelegramCollectionTask>>(
        `/telegram/collections?page=${collectionTaskPage}&size=10`,
      ),
    enabled: Boolean(view && can("telegram:view")),
    refetchInterval: 3000,
    retry: false,
  });

  /** Loads the selected task's saved messages from a separate server-paged endpoint. */
  const collectionMessages = useQuery({
    queryKey: [
      "telegram",
      "collection-messages",
      selectedCollection?.id,
      collectionPage,
    ],
    queryFn: () =>
      api<PageResult<TelegramCollectedMessage>>(
        `/telegram/collections/${selectedCollection!.id}/messages?page=${collectionPage}&size=10`,
      ),
    enabled: Boolean(selectedCollection && can("telegram:view")),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        item.media.some((attachment) =>
          ["QUEUED", "DOWNLOADING"].includes(attachment.status),
        ),
      )
        ? 2500
        : false,
  });

  /** Creates a bounded message-link or already-joined-channel task. */
  const createCollection = useMutation({
    mutationFn: () =>
      api<TelegramCollectionTask>("/telegram/collections", {
        method: "POST",
        body: JSON.stringify({
          ...(collectionSource === "link"
            ? { messageLink: messageLink.trim() }
            : { channelId }),
          ...(collectionDateRange?.[0] && collectionDateRange[1]
            ? {
                fromDate: collectionDateRange[0].format("YYYY-MM-DD"),
                toDate: collectionDateRange[1].format("YYYY-MM-DD"),
              }
            : {}),
          maxMessages,
          downloadImages,
          downloadVideos,
          downloadDocuments,
        }),
      }),
    onSuccess: async () => {
      setMessageLink("");
      setChannelId(undefined);
      setChannelSearchText("");
      setChannelQuery("");
      setCollectionDateRange(null);
      setDownloadImages(false);
      setDownloadVideos(false);
      setDownloadDocuments(false);
      setCollectionTaskPage(1);
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "collections"],
      });
      message.success("采集任务已加入队列");
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Controls only the selected task and lets the backend re-check owner, scope and state. */
  const collectionAction = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: number;
      action: "pause" | "resume" | "cancel";
    }) =>
      api<TelegramCollectionTask>(`/telegram/collections/${id}/${action}`, {
        method: "POST",
      }),
    onSuccess: async (task) => {
      setSelectedCollection(task);
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "collections"],
      });
      message.success(task.statusMessage);
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Opts one completed channel task into bounded, explicitly visible polling. */
  const collectionTracking = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api<TelegramCollectionTask>(`/telegram/collections/${id}/tracking`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: async (task) => {
      setSelectedCollection(task);
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "collections"],
      });
      message.success(task.liveStatusMessage ?? "定期追赶设置已更新");
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Permanently removes a stopped task and its locally collected messages. */
  const deleteCollection = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/telegram/collections/${id}`, { method: "DELETE" }),
    onSuccess: async (_, id) => {
      if (selectedCollection?.id === id) setSelectedCollection(null);
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "collections"],
      });
      message.success("采集任务及本地消息已删除");
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Retries a failed file while the server rechecks task policy and current permissions. */
  const retryMedia = useMutation({
    mutationFn: (id: number) =>
      api<TelegramCollectedMedia>(`/telegram/media/${id}/retry`, {
        method: "POST",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "collection-messages", selectedCollection?.id],
      });
      message.success("附件已重新加入下载队列");
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Exposes messages that arrived in the verified bot chat but lacked a reliable search association. */
  const unmatchedMessages = useQuery({
    queryKey: ["telegram", "unmatched-messages"],
    queryFn: () =>
      api<PageResult<TelegramMessage>>(
        "/telegram/messages/unmatched?page=1&size=5",
      ),
    enabled: Boolean(view && can("telegram:view")),
    refetchInterval: 3000,
    retry: false,
  });

  /** Loads captured bot updates only for the search explicitly selected by the user. */
  const rawMessages = useQuery({
    queryKey: ["telegram", "search-messages", messageSearch?.id, messagePage],
    queryFn: () =>
      api<PageResult<TelegramMessage>>(
        `/telegram/searches/${messageSearch!.id}/messages?page=${messagePage}&size=30`,
      ),
    enabled: Boolean(messageSearch && can("telegram:view")),
    refetchInterval: messageSearch?.status === "WAITING" ? 2500 : false,
    retry: false,
  });

  /** Keeps parser candidates paged by the source message that produced them. */
  const parsedMessages = useQuery({
    queryKey: [
      "telegram",
      "search-results",
      messageSearch?.id,
      parsedMessagePage,
    ],
    queryFn: () =>
      api<PageResult<ParsedTelegramMessage>>(
        `/telegram/searches/${messageSearch!.id}/results?page=${parsedMessagePage}&size=30`,
      ),
    enabled: Boolean(messageSearch && can("telegram:view")),
    refetchInterval: messageSearch?.status === "WAITING" ? 2500 : false,
    retry: false,
  });

  /** Search history only displays fixed server states; reply bodies are opened separately. */
  const searchColumns = useMemo<ColumnsType<TelegramSearch>>(
    () => [
      { title: "关键词", dataIndex: "keyword", ellipsis: true },
      {
        title: "机器人",
        dataIndex: "botUsername",
        render: (name: string) => `@${name}`,
      },
      {
        title: "状态",
        dataIndex: "status",
        render: (state: string) => (
          <Tag
            color={
              state === "COMPLETED"
                ? "success"
                : state === "FAILED"
                  ? "error"
                  : "processing"
            }
          >
            {searchStatusLabel(state)}
          </Tag>
        ),
      },
      { title: "创建时间", dataIndex: "createdAt", width: 180 },
      {
        title: "操作",
        key: "action",
        width: 120,
        render: (_, row) => (
          <Button
            type="link"
            onClick={() => {
              setMessagePage(1);
              setParsedMessagePage(1);
              setMessageSearch(row);
            }}
          >
            查看原始回复
          </Button>
        ),
      },
    ],
    [],
  );

  /** Sends one deliberate search only after the user confirms the keyword in this page. */
  const search = useMutation({
    mutationFn: (query: string) =>
      api<TelegramSearch>("/telegram/searches", {
        method: "POST",
        body: JSON.stringify({ keyword: query }),
      }),
    onSuccess: async (created) => {
      setKeyword("");
      queryClient.setQueryData<PageResult<TelegramSearch>>(
        ["telegram", "searches", searchPage],
        (current) => ({
          items: [
            created,
            ...(current?.items ?? []).filter((item) => item.id !== created.id),
          ].slice(0, 20),
          total: (current?.total ?? 0) + 1,
          page: 1,
          size: 20,
        }),
      );
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "searches"],
      });
      message.success("搜索请求已提交；机器人回复会异步出现在记录中");
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Sends one short-lived authorization input and clears the visible form after acceptance. */
  function submitChallenge() {
    if (!challenge || !value.trim()) return;
    action.mutate({ endpoint: challenge.endpoint, value: value.trim() });
  }

  /** Completes the optional profile-registration step requested by Telegram. */
  function submitRegistration() {
    action.mutate({
      endpoint: "/session/register",
      body: { firstName: firstName.trim(), lastName: lastName.trim() },
    });
  }

  return (
    <Space direction="vertical" size={16} style={{ display: "flex" }}>
      <Card
        title="Telegram 账号"
        extra={
          <Button
            aria-label="刷新 Telegram 状态"
            icon={<ReloadOutlined />}
            onClick={() => void status.refetch()}
          />
        }
      >
        {status.isPending ? (
          <Typography.Text type="secondary">
            正在读取 Telegram 状态…
          </Typography.Text>
        ) : status.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法读取 Telegram 状态"
            description="请确认模块已启用，并且当前账号拥有 Telegram 查看权限。"
          />
        ) : view ? (
          <>
            <Alert
              type={
                view.state === "READY"
                  ? "success"
                  : view.state === "ERROR"
                    ? "error"
                    : "info"
              }
              showIcon
              message={view.message}
              description="验证码、两步验证密码和邮箱验证内容仅用于当前请求，不会保存到数据库或浏览器本地存储。"
            />
            <Descriptions
              column={{ xs: 1, sm: 2, lg: 3 }}
              style={{ marginTop: 20 }}
              items={[
                {
                  key: "module",
                  label: "模块状态",
                  children: (
                    <Tag color={view.enabled ? "green" : "default"}>
                      {view.enabled ? "已启用" : "已关闭"}
                    </Tag>
                  ),
                },
                {
                  key: "account",
                  label: "账号状态",
                  children: (
                    <Tag color={view.connected ? "green" : "blue"}>
                      {STATE_LABELS[view.state] ?? "未知状态"}
                    </Tag>
                  ),
                },
                {
                  key: "phone",
                  label: "账号标识",
                  children: view.maskedPhoneNumber ?? "尚未绑定",
                },
                {
                  key: "api",
                  label: "API 凭据",
                  children: view.credentialsConfigured
                    ? "已配置"
                    : "待部署人员配置",
                },
                {
                  key: "encryption",
                  label: "会话加密",
                  children: view.encryptionKeyConfigured
                    ? "密钥已配置"
                    : "待部署人员配置",
                },
                {
                  key: "proxy",
                  label: "Telegram 网络代理",
                  children: view.proxyEnabled
                    ? view.proxyConfigured
                      ? `${view.proxyType.toUpperCase()} 已配置`
                      : "配置无效，无法连接"
                    : "未启用",
                },
                {
                  key: "archiveTool",
                  label: "RAR / 7z 支持",
                  children: view.archiveToolAvailable
                    ? "已检测到 7-Zip"
                    : "未检测到 7-Zip",
                },
                {
                  key: "videoTools",
                  label: "视频预览工具",
                  children: view.videoPreviewToolsAvailable
                    ? "已检测到 FFmpeg / FFprobe"
                    : "未检测到 FFmpeg / FFprobe",
                },
                {
                  key: "user",
                  label: "Telegram 用户 ID",
                  children: view.telegramUserId ?? "授权后显示",
                },
              ]}
            />
          </>
        ) : null}
      </Card>

      {view &&
        (!view.credentialsConfigured || !view.encryptionKeyConfigured) && (
          <Alert
            type="warning"
            showIcon
            message="还不能发起账号授权"
            description="请由部署人员在服务端私有环境配置 Telegram API 凭据和会话加密密钥，然后重启服务。敏感值不会在本页面编辑或回显。"
          />
        )}

      {view &&
        canConnect &&
        view.credentialsConfigured &&
        view.encryptionKeyConfigured && (
          <Card title="授权步骤">
            {challenge ? (
              <Form
                layout="vertical"
                onFinish={submitChallenge}
                style={{ maxWidth: 560 }}
                autoComplete="off"
              >
                <Form.Item label={challenge.label} required>
                  {challenge.password ? (
                    <Input.Password
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={challenge.placeholder}
                      autoComplete="new-password"
                    />
                  ) : (
                    <Input
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                      placeholder={challenge.placeholder}
                      autoComplete="off"
                    />
                  )}
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={isBusy}
                  disabled={!value.trim()}
                >
                  提交并继续
                </Button>
                {view.state === "WAITING_FOR_CODE" && (
                  <Typography.Paragraph
                    type="secondary"
                    style={{ marginTop: 12, marginBottom: 0 }}
                  >
                    Telegram 可能把验证码发到已登录的 Telegram
                    客户端，不一定通过短信发送。
                  </Typography.Paragraph>
                )}
              </Form>
            ) : view.state === "WAITING_FOR_REGISTRATION" ? (
              <Form
                layout="vertical"
                onFinish={submitRegistration}
                style={{ maxWidth: 560 }}
              >
                <Form.Item label="名字" required>
                  <Input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    maxLength={64}
                  />
                </Form.Item>
                <Form.Item label="姓氏">
                  <Input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    maxLength={64}
                  />
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={isBusy}
                  disabled={!firstName.trim()}
                >
                  完成注册
                </Button>
              </Form>
            ) : (
              <Space wrap>
                {!view.connected &&
                  view.state !== "INITIALIZING" &&
                  view.state !== "CLOSING" && (
                    <Button
                      type="primary"
                      icon={<LoginOutlined />}
                      loading={isBusy}
                      onClick={() =>
                        action.mutate({ endpoint: "/session/start" })
                      }
                    >
                      {view.accountConfigured
                        ? "重新连接"
                        : "连接 Telegram 账号"}
                    </Button>
                  )}
                {view.connected && canClose && (
                  <Button
                    icon={<DisconnectOutlined />}
                    loading={isBusy}
                    onClick={() =>
                      action.mutate({ endpoint: "/session/close" })
                    }
                  >
                    关闭连接并保留会话
                  </Button>
                )}
                {view.connected && canLogOut && (
                  <Button
                    danger
                    icon={<LogoutOutlined />}
                    loading={isBusy}
                    onClick={() =>
                      Modal.confirm({
                        title: "退出 Telegram 账号？",
                        content:
                          "退出会清除本地可复用会话，下次连接需要重新完成授权。",
                        okText: "确认退出",
                        cancelText: "取消",
                        okButtonProps: { danger: true },
                        onOk: () =>
                          action.mutateAsync({ endpoint: "/session/logout" }),
                      })
                    }
                  >
                    退出 Telegram 账号
                  </Button>
                )}
                {view.connected && (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    会话已授权
                  </Tag>
                )}
                {view.state === "WAITING_FOR_DEVICE_CONFIRMATION" && (
                  <Typography.Text type="secondary">
                    请查看 Telegram 客户端并确认新的登录设备。
                  </Typography.Text>
                )}
              </Space>
            )}
            {!canConnect && (
              <Typography.Text type="secondary">
                当前账号没有连接或授权 Telegram 的权限。
              </Typography.Text>
            )}
          </Card>
        )}

      {view?.connected && can("telegram:search") && (
        <Card title="极搜消息">
          <Space.Compact style={{ width: "100%", maxWidth: 720 }}>
            <Input
              value={keyword}
              maxLength={256}
              placeholder="输入关键词，发送给服务端配置的搜索机器人"
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() =>
                keyword.trim() && search.mutate(keyword.trim())
              }
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={search.isPending}
              disabled={!keyword.trim()}
              onClick={() => search.mutate(keyword.trim())}
            >
              搜索
            </Button>
          </Space.Compact>
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="只有点击搜索后才会向配置的 Telegram 机器人发送关键词。系统按 Telegram 明确的回复关系关联消息，不会把无关消息猜成搜索结果。"
          />
          <Table<TelegramSearch>
            rowKey="id"
            style={{ marginTop: 16 }}
            columns={searchColumns}
            dataSource={searchHistory.data?.items ?? []}
            loading={searchHistory.isPending}
            pagination={{
              current: searchPage,
              pageSize: 20,
              total: searchHistory.data?.total ?? 0,
              hideOnSinglePage: true,
              onChange: setSearchPage,
            }}
            locale={{ emptyText: "暂无搜索记录" }}
          />
        </Card>
      )}

      {view && can("telegram:view") && (
        <Card title="消息采集">
          <Alert
            type="info"
            showIcon
            message="按授权范围采集 Telegram 消息"
            description="可从消息链接开始，或从当前账号已加入的频道开始；日期范围包含首尾两天。每项任务最多保存 500 条，最多检查 5000 条历史消息；系统不会自动加入频道。受保护消息不会保存正文或附件。"
            style={{ marginBottom: 20 }}
          />
          {can("telegram:collect") ? (
            <Space
              direction="vertical"
              size={12}
              style={{ width: "100%", marginBottom: 20 }}
            >
              <Radio.Group
                aria-label="采集来源类型"
                optionType="button"
                buttonStyle="solid"
                value={collectionSource}
                onChange={(event) => {
                  setCollectionSource(event.target.value);
                  setChannelId(undefined);
                  setChannelSearchText("");
                  setChannelQuery("");
                }}
                options={[
                  { label: "消息链接", value: "link" },
                  { label: "已加入频道", value: "channel" },
                ]}
              />
              <Space wrap align="center">
                {collectionSource === "link" ? (
                  <Input
                    aria-label="Telegram 消息链接"
                    placeholder="粘贴 t.me 消息链接"
                    value={messageLink}
                    onChange={(event) => setMessageLink(event.target.value)}
                    style={{ width: 340 }}
                    maxLength={2048}
                  />
                ) : (
                  <Select
                    aria-label="选择已加入的 Telegram 频道"
                    showSearch
                    filterOption={false}
                    allowClear
                    placeholder="输入至少 2 个字搜索已加入的频道"
                    value={channelId}
                    onSearch={setChannelSearchText}
                    onChange={(value: string | undefined) =>
                      setChannelId(value)
                    }
                    loading={collectionChannels.isFetching}
                    notFoundContent={
                      channelSearchText.trim().length < 2
                        ? "输入至少 2 个字开始搜索"
                        : collectionChannels.isError
                          ? "搜索失败，请确认账号已连接"
                          : "没有找到可访问的频道"
                    }
                    options={(collectionChannels.data ?? []).map((channel) => ({
                      value: channel.chatId,
                      label: `${channel.title}${channel.username ? ` · @${channel.username}` : ""}`,
                    }))}
                    style={{ width: 340 }}
                  />
                )}
                <DatePicker.RangePicker
                  aria-label="采集日期范围"
                  value={collectionDateRange}
                  onChange={(dates) =>
                    setCollectionDateRange(dates ? [dates[0], dates[1]] : null)
                  }
                  disabledDate={(date) =>
                    date.isAfter(dayjs(), "day") ||
                    date.isBefore(dayjs().subtract(10, "year"), "day")
                  }
                  placeholder={["开始日期", "结束日期"]}
                />
                <InputNumber
                  aria-label="采集条数上限"
                  min={1}
                  max={500}
                  value={maxMessages}
                  onChange={(value) => setMaxMessages(value ?? 100)}
                  addonAfter="条"
                  style={{ width: 130 }}
                />
                <Button
                  type="primary"
                  disabled={
                    collectionSource === "link"
                      ? !messageLink.trim()
                      : !channelId
                  }
                  loading={createCollection.isPending}
                  onClick={() => createCollection.mutate()}
                >
                  新建采集
                </Button>
              </Space>
              {can("telegram:download") ? (
                <Space wrap>
                  <Typography.Text type="secondary">保存附件：</Typography.Text>
                  <Checkbox
                    checked={downloadImages}
                    onChange={(event) =>
                      setDownloadImages(event.target.checked)
                    }
                  >
                    图片
                  </Checkbox>
                  <Checkbox
                    checked={downloadVideos}
                    onChange={(event) =>
                      setDownloadVideos(event.target.checked)
                    }
                  >
                    视频
                  </Checkbox>
                  <Checkbox
                    checked={downloadDocuments}
                    onChange={(event) =>
                      setDownloadDocuments(event.target.checked)
                    }
                  >
                    文件
                  </Checkbox>
                </Space>
              ) : null}
            </Space>
          ) : null}
          <Table<TelegramCollectionTask>
            rowKey="id"
            columns={[
              {
                title: "采集来源",
                dataIndex: "sourceTitle",
                ellipsis: true,
                render: (_title: string | null, task) => (
                  <Space direction="vertical" size={0}>
                    {task.messageLink ? (
                      <Typography.Text copyable>
                        {task.messageLink}
                      </Typography.Text>
                    ) : (
                      <Typography.Text>
                        {task.sourceTitle ?? "已加入频道"}
                      </Typography.Text>
                    )}
                    {task.fromDate || task.toDate ? (
                      <Typography.Text type="secondary">
                        {task.fromDate ?? "最早消息"} 至{" "}
                        {task.toDate ?? "最新消息"}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              },
              {
                title: "进度",
                width: 150,
                render: (_, task) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text>
                      已保存 {task.collectedMessages} / {task.maxMessages} 条
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      已检查 {task.scannedMessages} / 5000 条
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 150,
                render: (status: string) => (
                  <Tag
                    color={
                      status === "COMPLETED"
                        ? "success"
                        : status === "FAILED"
                          ? "error"
                          : "processing"
                    }
                  >
                    {status}
                  </Tag>
                ),
              },
              { title: "创建时间", dataIndex: "createdAt", width: 190 },
              {
                title: "进度说明",
                dataIndex: "statusMessage",
                ellipsis: true,
                render: (statusMessage: string, task) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text ellipsis>{statusMessage}</Typography.Text>
                    {task.trackingEnabled || task.liveStatusMessage ? (
                      <Typography.Text type="secondary" ellipsis>
                        {task.liveStatusMessage ?? "定期追赶尚未启用"}
                        {task.liveCheckedAt
                          ? ` · 最近检查 ${task.liveCheckedAt}`
                          : ""}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              },
              {
                title: "操作",
                width: 340,
                render: (_, task) => (
                  <Space size={4}>
                    <Button
                      type="link"
                      onClick={() => {
                        setCollectionPage(1);
                        setSelectedCollection(task);
                      }}
                    >
                      查看消息
                    </Button>
                    {can("telegram:collect") &&
                    !task.messageLink &&
                    task.status === "COMPLETED" &&
                    task.toDate === null ? (
                      <Button
                        type="link"
                        loading={collectionTracking.isPending}
                        onClick={() =>
                          collectionTracking.mutate({
                            id: task.id,
                            enabled: !task.trackingEnabled,
                          })
                        }
                      >
                        {task.trackingEnabled ? "停止追赶" : "开启追赶"}
                      </Button>
                    ) : null}
                    {can("telegram:collect") && task.status === "PAUSED" ? (
                      <Button
                        type="link"
                        onClick={() =>
                          collectionAction.mutate({
                            id: task.id,
                            action: "resume",
                          })
                        }
                      >
                        继续
                      </Button>
                    ) : null}
                    {can("telegram:collect") &&
                    ["QUEUED", "RUNNING", "WAITING_ACCOUNT"].includes(
                      task.status,
                    ) ? (
                      <Button
                        type="link"
                        onClick={() =>
                          collectionAction.mutate({
                            id: task.id,
                            action: "pause",
                          })
                        }
                      >
                        暂停
                      </Button>
                    ) : null}
                    {can("telegram:collect") &&
                    !["COMPLETED", "FAILED", "CANCELLED"].includes(
                      task.status,
                    ) ? (
                      <Button
                        type="link"
                        danger
                        onClick={() =>
                          collectionAction.mutate({
                            id: task.id,
                            action: "cancel",
                          })
                        }
                      >
                        取消
                      </Button>
                    ) : null}
                    {can("telegram:delete") &&
                    ["COMPLETED", "FAILED", "CANCELLED"].includes(
                      task.status,
                    ) ? (
                      <Button
                        type="link"
                        danger
                        loading={deleteCollection.isPending}
                        onClick={() =>
                          modal.confirm({
                            title: "删除采集记录？",
                            content:
                              "这会永久删除本地任务记录和已采集消息，不会影响 Telegram 上的原始消息。",
                            okText: "删除",
                            okButtonProps: { danger: true },
                            cancelText: "保留",
                            onOk: () => deleteCollection.mutateAsync(task.id),
                          })
                        }
                      >
                        删除
                      </Button>
                    ) : null}
                  </Space>
                ),
              },
            ]}
            dataSource={collectionTasks.data?.items ?? []}
            loading={collectionTasks.isPending}
            pagination={{
              current: collectionTaskPage,
              pageSize: 10,
              total: collectionTasks.data?.total ?? 0,
              onChange: setCollectionTaskPage,
              hideOnSinglePage: true,
            }}
            locale={{ emptyText: "暂无采集任务" }}
          />
        </Card>
      )}

      <Modal
        title={
          selectedCollection
            ? `采集消息 · ${selectedCollection.collectedMessages} 条`
            : "采集消息"
        }
        open={Boolean(selectedCollection)}
        width={1000}
        onCancel={() => setSelectedCollection(null)}
        footer={
          <Button onClick={() => setSelectedCollection(null)}>关闭</Button>
        }
        destroyOnHidden
      >
        {selectedCollection && (
          <>
            <Alert
              type="info"
              showIcon
              message={selectedCollection.statusMessage}
            />
            <Table<TelegramCollectedMessage>
              rowKey="id"
              style={{ marginTop: 16 }}
              columns={[
                {
                  title: "消息 ID",
                  dataIndex: "telegramMessageId",
                  width: 150,
                },
                {
                  title: "类型",
                  dataIndex: "contentType",
                  width: 150,
                  render: (value: string | null) => value ?? "受保护",
                },
                {
                  title: "正文 / 附件元数据",
                  render: (_, item) => (
                    <Space
                      direction="vertical"
                      size={4}
                      style={{ width: "100%" }}
                    >
                      <Typography.Paragraph
                        ellipsis={{ rows: 3, expandable: true }}
                        style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
                      >
                        {item.canBeSaved
                          ? item.messageText || "（无正文；可能为媒体消息）"
                          : "Telegram 不允许保存此消息内容"}
                      </Typography.Paragraph>
                      {item.canBeSaved && item.media.length > 0 ? (
                        <Image.PreviewGroup>
                          <Space wrap>
                            {item.media.map((attachment) => (
                              <Space
                                key={attachment.id}
                                direction="vertical"
                                size={2}
                              >
                                <TelegramMediaPreview attachment={attachment} />
                                {attachment.status === "AVAILABLE" &&
                                [
                                  "application/zip",
                                  "application/vnd.rar",
                                  "application/x-7z-compressed",
                                ].includes(attachment.mediaType ?? "") &&
                                can("telegram:download") &&
                                can("telegram:extract") ? (
                                  <TelegramArchiveBrowser
                                    mediaId={attachment.id}
                                  />
                                ) : null}
                                <Tag
                                  color={
                                    attachment.status === "AVAILABLE"
                                      ? "success"
                                      : attachment.status === "FAILED"
                                        ? "error"
                                        : attachment.status === "EXPIRED"
                                          ? "default"
                                          : "processing"
                                  }
                                >
                                  {attachment.status === "AVAILABLE"
                                    ? "已就绪"
                                    : attachment.status === "FAILED"
                                      ? "下载失败"
                                      : attachment.status === "DELETING"
                                        ? "清理中"
                                        : attachment.status === "EXPIRED"
                                          ? "已清理"
                                          : "下载中"}
                                </Tag>
                                {["FAILED", "EXPIRED"].includes(
                                  attachment.status,
                                ) && can("telegram:download") ? (
                                  <Button
                                    type="link"
                                    size="small"
                                    loading={retryMedia.isPending}
                                    onClick={() =>
                                      retryMedia.mutate(attachment.id)
                                    }
                                  >
                                    {attachment.status === "EXPIRED"
                                      ? "重新下载"
                                      : "重试"}
                                  </Button>
                                ) : null}
                                {attachment.failureMessage ? (
                                  <Typography.Text type="danger">
                                    {attachment.failureMessage}
                                  </Typography.Text>
                                ) : null}
                              </Space>
                            ))}
                          </Space>
                        </Image.PreviewGroup>
                      ) : item.canBeSaved && item.metadataJson !== "[]" ? (
                        <Typography.Text type="secondary">
                          {item.metadataJson}
                        </Typography.Text>
                      ) : null}
                    </Space>
                  ),
                },
                {
                  title: "发送时间",
                  dataIndex: "telegramSentAt",
                  width: 190,
                  render: (value: string | null) => value ?? "—",
                },
              ]}
              dataSource={collectionMessages.data?.items ?? []}
              loading={collectionMessages.isPending}
              pagination={{
                current: collectionPage,
                pageSize: 10,
                total: collectionMessages.data?.total ?? 0,
                onChange: setCollectionPage,
                showSizeChanger: false,
              }}
              locale={{ emptyText: "任务开始后，已保存的消息会分页显示在这里" }}
            />
          </>
        )}
      </Modal>

      {view?.connected && can("telegram:view") && (
        <Card title="未匹配的机器人消息">
          <Typography.Paragraph type="secondary">
            这些消息来自已验证的搜索机器人私聊，但没有 Telegram
            明确的回复关联。它们不会被拼接到某次搜索或伪装为搜索结果。
          </Typography.Paragraph>
          <Table<TelegramMessage>
            rowKey="id"
            columns={[
              { title: "类型", dataIndex: "contentType", width: 200 },
              {
                title: "内容",
                dataIndex: "messageText",
                render: (text: string | null) => (
                  <Typography.Paragraph
                    ellipsis={{ rows: 2 }}
                    style={{ marginBottom: 0 }}
                  >
                    {text || "（无文本内容）"}
                  </Typography.Paragraph>
                ),
              },
              {
                title: "到达时间",
                dataIndex: "telegramSentAt",
                width: 200,
                render: (value: string | null) => value ?? "—",
              },
            ]}
            dataSource={unmatchedMessages.data?.items ?? []}
            loading={unmatchedMessages.isPending}
            pagination={false}
            locale={{ emptyText: "目前没有未匹配的机器人消息" }}
          />
        </Card>
      )}

      <Modal
        title={
          messageSearch
            ? `“${messageSearch.keyword}”的原始机器人消息`
            : "原始机器人消息"
        }
        open={Boolean(messageSearch)}
        width={920}
        onCancel={() => setMessageSearch(null)}
        footer={<Button onClick={() => setMessageSearch(null)}>关闭</Button>}
        destroyOnHidden
      >
        {messageSearch && (
          <>
            <Alert
              type={
                messageSearch.parseStatus === "UNKNOWN" ? "warning" : "info"
              }
              showIcon
              message={messageSearch.statusMessage}
            />
            <Table<TelegramMessage>
              rowKey="id"
              style={{ marginTop: 16 }}
              columns={[
                {
                  title: "方向",
                  dataIndex: "outgoing",
                  width: 90,
                  render: (outgoing: boolean) => (outgoing ? "发出" : "收到"),
                },
                { title: "消息类型", dataIndex: "contentType", width: 180 },
                {
                  title: "回复关联",
                  dataIndex: "associationStatus",
                  width: 120,
                  render: (value: string) =>
                    value === "MATCHED" ? (
                      <Tag color="success">明确关联</Tag>
                    ) : (
                      <Tag>未匹配</Tag>
                    ),
                },
                {
                  title: "消息正文",
                  dataIndex: "messageText",
                  render: (text: string | null, row: TelegramMessage) => {
                    const keyboard = inlineKeyboard(row.replyMarkupJson);
                    return (
                      <Space
                        direction="vertical"
                        size={8}
                        style={{ width: "100%" }}
                      >
                        <Typography.Paragraph
                          style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
                          ellipsis={{
                            rows: 5,
                            expandable: true,
                            symbol: "展开",
                          }}
                        >
                          {text || "（无文本内容）"}
                        </Typography.Paragraph>
                        {row.outgoing || keyboard.length === 0 ? null : (
                          <Space direction="vertical" size={4}>
                            {keyboard.map((buttons, rowIndex) => (
                              <Space
                                key={`${row.id}-${rowIndex}`}
                                wrap
                                size={4}
                              >
                                {buttons.map((button, columnIndex) =>
                                  button.type === "CALLBACK" ? (
                                    <Button
                                      key={`${row.id}-${rowIndex}-${columnIndex}`}
                                      size="small"
                                      loading={callback.isPending}
                                      disabled={
                                        !messageSearch ||
                                        !can("telegram:search")
                                      }
                                      onClick={() =>
                                        messageSearch &&
                                        callback.mutate({
                                          searchId: messageSearch.id,
                                          messageId: row.id,
                                          row: rowIndex,
                                          column: columnIndex,
                                        })
                                      }
                                    >
                                      {button.text}
                                    </Button>
                                  ) : button.type === "URL" &&
                                    isSafeHttpsUrl(button.url) ? (
                                    <Typography.Link
                                      key={`${row.id}-${rowIndex}-${columnIndex}`}
                                      href={button.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {button.text}
                                    </Typography.Link>
                                  ) : null,
                                )}
                              </Space>
                            ))}
                          </Space>
                        )}
                      </Space>
                    );
                  },
                },
                {
                  title: "更新时间",
                  dataIndex: "telegramEditedAt",
                  width: 180,
                  render: (value: string | null, row: TelegramMessage) =>
                    value ?? row.telegramSentAt ?? "—",
                },
              ]}
              dataSource={rawMessages.data?.items ?? []}
              loading={rawMessages.isPending}
              pagination={{
                current: messagePage,
                pageSize: 30,
                total: rawMessages.data?.total ?? 0,
                onChange: setMessagePage,
                showSizeChanger: false,
              }}
              locale={{
                emptyText:
                  "尚无可展示的机器人消息；未知或未匹配消息不会被伪装成结果",
              }}
            />
            <Typography.Title level={5} style={{ marginTop: 24 }}>
              识别到的链接候选
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              仅从本次已关联回复的文字中提取链接，不推断标题、媒体类型或频道权限；请先核对来源消息。
            </Typography.Paragraph>
            <Table<ParsedTelegramMessage>
              rowKey="id"
              size="small"
              columns={[
                {
                  title: "来源消息",
                  dataIndex: "messageText",
                  render: (text: string | null) => (
                    <Typography.Paragraph
                      ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
                      style={{ marginBottom: 0 }}
                    >
                      {text || "（无文本内容）"}
                    </Typography.Paragraph>
                  ),
                },
                {
                  title: "链接",
                  dataIndex: "sourceLinks",
                  width: 360,
                  render: (links: TelegramSourceLink[]) =>
                    links.length ? (
                      <Space direction="vertical" size={4}>
                        {links.map((link, index) => (
                          <Typography.Link
                            key={`${link.sourceMessageId}-${index}`}
                            href={
                              isSafeHttpsUrl(link.url) ? link.url : undefined
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {link.sourceType === "TELEGRAM_MESSAGE"
                              ? `Telegram · ${link.publicChat}`
                              : link.host}
                          </Typography.Link>
                        ))}
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">
                        未发现可识别链接
                      </Typography.Text>
                    ),
                },
                {
                  title: "时间",
                  dataIndex: "telegramEditedAt",
                  width: 180,
                  render: (
                    editedAt: string | null,
                    row: ParsedTelegramMessage,
                  ) => editedAt ?? row.telegramSentAt ?? "—",
                },
              ]}
              dataSource={parsedMessages.data?.items ?? []}
              loading={parsedMessages.isPending}
              pagination={{
                current: parsedMessagePage,
                pageSize: 30,
                total: parsedMessages.data?.total ?? 0,
                onChange: setParsedMessagePage,
                showSizeChanger: false,
              }}
              locale={{
                emptyText: "收到与查询关联的消息后，会在这里提取可核对的链接",
              }}
            />
          </>
        )}
      </Modal>

      <Card title="连接说明">
        <Space direction="vertical" size={8}>
          <Typography.Text>
            连接会创建加密的本地 TDLib
            会话；模块关闭时不加载原生库，也不发起连接。
          </Typography.Text>
          <Typography.Text>
            “关闭连接”保留已授权会话；“退出 Telegram
            账号”会删除复用授权，两者操作分开。
          </Typography.Text>
          <Typography.Text type="secondary">
            <LockOutlined /> 当前页面以分页方式呈现 Telegram
            消息快照；未识别的消息仅作为原始消息展示，不生成虚构的搜索条目。
          </Typography.Text>
        </Space>
      </Card>
    </Space>
  );
}
