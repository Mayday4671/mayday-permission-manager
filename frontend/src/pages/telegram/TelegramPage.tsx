import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Image,
  Modal,
  Space,
  Table,
  Tag,
  Tabs,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  EditOutlined,
  MenuOutlined,
  ClockCircleOutlined,
  CustomerServiceOutlined,
  DisconnectOutlined,
  DoubleLeftOutlined,
  DownloadOutlined,
  FilterOutlined,
  FolderOutlined,
  LeftOutlined,
  LoginOutlined,
  LogoutOutlined,
  MessageOutlined,
  NotificationOutlined,
  PictureOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  ScanOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Select } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import dayjs, { type Dayjs } from "dayjs";
import {
  TelegramMessageMediaPreview,
  TelegramInlineMediaItem,
} from "./TelegramMessageMediaPreview";
import { TelegramMediaPolicySettings } from "./TelegramMediaPolicySettings";
import { TelegramAttachmentDownload } from "./TelegramAttachmentDownload";
import type {
  TelegramCollectionTask,
  TelegramCollectedMessage,
  TelegramCollectedMedia,
} from "./telegram-media-types";
import {
  TelegramConversationSidebar,
  type TelegramConversationSummary,
} from "./TelegramConversationSidebar";
import { TelegramArchiveBrowser } from "./TelegramArchiveBrowser";
import { TelegramChannelBrowser } from "./TelegramChannelBrowser";
import "./telegram-page.css";

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

interface TelegramInlineTextLink {
  offset: number;
  length: number;
  url: string;
}

interface TelegramConversationMessage {
  id: number;
  telegramMessageId: string;
  contentType: string;
  messageText: string | null;
  replyMarkupJson: string;
  telegramSentAt: string | null;
  telegramEditedAt: string | null;
  associationStatus: string;
  sourceLinks: TelegramSourceLink[];
  inlineLinks: TelegramInlineTextLink[];
}

interface TelegramConversationTurn {
  search: TelegramSearch;
  messages: TelegramConversationMessage[];
}

/** 采集详情复用同一鉴权预览，避免普通文件在用户点击下载前被自动读取。 */
function TelegramMediaPreview({
  attachment,
}: {
  attachment: TelegramCollectedMedia;
}) {
  if (attachment.status !== "AVAILABLE" || !attachment.contentUrl) return null;
  return (
    <div style={{ width: 240, maxWidth: "100%" }}>
      <TelegramInlineMediaItem attachment={attachment} />
    </div>
  );
}

interface InlineButton {
  text: string;
  type: string;
  url?: string;
}

type SearchResourceType =
  | "groups"
  | "channels"
  | "videos"
  | "images"
  | "music"
  | "chats"
  | "bots"
  | "files";

interface SearchResourceOption {
  value: SearchResourceType;
  label: string;
  icon: ReactNode;
  buttonAliases: string[];
}

/**
 * Mirrors the resource categories shown by the configured search bot.
 * Bot labels can vary by language and may include emoji, so aliases are used
 * only to recognize the callback button; the interface supplies its own icon.
 */
const SEARCH_RESOURCE_TYPES: SearchResourceOption[] = [
  {
    value: "groups",
    label: "群组",
    icon: <TeamOutlined />,
    buttonAliases: ["👥", "群组"],
  },
  {
    value: "channels",
    label: "频道",
    icon: <NotificationOutlined />,
    buttonAliases: ["📢", "频道"],
  },
  {
    value: "videos",
    label: "视频",
    icon: <VideoCameraOutlined />,
    buttonAliases: ["🎬", "🎞", "📹", "视频"],
  },
  {
    value: "images",
    label: "图片",
    icon: <PictureOutlined />,
    buttonAliases: ["🏞", "🖼", "📷", "图片"],
  },
  {
    value: "music",
    label: "音乐",
    icon: <CustomerServiceOutlined />,
    buttonAliases: ["🎧", "音乐"],
  },
  {
    value: "chats",
    label: "聊天",
    icon: <MessageOutlined />,
    buttonAliases: ["💬", "聊天"],
  },
  {
    value: "bots",
    label: "机器人",
    icon: <RobotOutlined />,
    buttonAliases: ["🤖", "机器人"],
  },
  {
    value: "files",
    label: "文件",
    icon: <FolderOutlined />,
    buttonAliases: ["📁", "文件"],
  },
];
/** Waits longer for Telegram callback answers than for ordinary API requests. */
const TELEGRAM_CALLBACK_TIMEOUT_MS = 60_000;

interface PositionedInlineButton {
  button: InlineButton;
  row: number;
  column: number;
}

interface GroupedInlineKeyboard {
  resourceTypeButtons: PositionedInlineButton[];
  actionButtonRows: PositionedInlineButton[][];
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

type TelegramWorkspaceTab = "search" | "channels" | "collection" | "account";

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

/** Safe identity and peer-state details returned by the read-only bot diagnostic. */
interface TelegramBotSessionDiagnostic {
  telegramUserId: string;
  botUsername: string;
  botUserId: string;
  botChatId: string;
  cachedBlockListType: string;
  onlineMainBlockListStatus: "BLOCKED" | "NOT_BLOCKED" | "INCOMPLETE";
}

/** Safe operator configuration view; credentials are represented by presence flags only. */
interface TelegramConfigurationView {
  apiId: string;
  apiHashConfigured: boolean;
  sessionKeyConfigured: boolean;
  proxyEnabled: boolean;
  proxyType: string;
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPasswordConfigured: boolean;
  proxySecretConfigured: boolean;
  encryptionAvailable: boolean;
  databaseOverride: boolean;
}

/** Write-only Telegram secret inputs; blank values leave their existing server-side values unchanged. */
interface TelegramConfigurationForm {
  apiId: string;
  apiHash?: string;
  proxyEnabled: boolean;
  proxyType: string;
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword?: string;
  proxySecret?: string;
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
    label: "Telegram 账号手机号",
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

/** 采集状态与搜索状态分别命名，避免把消息保存完成显示成机器人回复完成。 */
function collectionStatusLabel(state: string): string {
  const labels: Record<string, string> = {
    QUEUED: "等待采集",
    RUNNING: "采集中",
    PAUSED: "已暂停",
    WAITING_ACCOUNT: "等待账号连接",
    COMPLETED: "已完成",
    FAILED: "失败",
    CANCELLED: "已取消",
  };
  return labels[state] ?? "状态未知";
}

/** Parses only the server's allow-listed, non-secret inline button projection. */
function inlineKeyboard(markup: string): (InlineButton | null)[][] {
  try {
    const parsed: unknown = JSON.parse(markup);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) =>
      Array.isArray(row)
        ? row.map((button): InlineButton | null =>
            Boolean(
              button &&
              typeof button === "object" &&
              typeof button.text === "string" &&
              typeof button.type === "string" &&
              (button.type !== "URL" || isSafeHttpsUrl(button.url)),
            )
              ? button
              : null,
          )
        : [],
    );
  } catch {
    return [];
  }
}

/** Maps only categories explicitly exposed by the configured bot's callback keyboard. */
function resourceTypeFromButton(text: string): SearchResourceType | null {
  const resourceType = SEARCH_RESOURCE_TYPES.find((item) =>
    item.buttonAliases.some((alias) =>
      text.toLocaleLowerCase().includes(alias.toLocaleLowerCase()),
    ),
  );
  return resourceType?.value ?? null;
}

/** Normalizes known bot labels while preserving the original callback coordinates. */
function callbackButtonLabel(text: string): string {
  const type = resourceTypeFromButton(text);
  if (!type) {
    if (/最新|\bnewest?\b/i.test(text)) return "最新";
    if (/过滤|\bfilter\b/i.test(text)) return "过滤";
    if (/时长/.test(text)) return "时长";
    if (/下一页|\bnext\b|^➡\uFE0F?$/i.test(text.trim())) return "下一页";
    if (/上一页|\bprevious\b|^⬅\uFE0F?$/i.test(text.trim())) return "上一页";
    if (/^⏮\uFE0F?$/.test(text.trim())) return "首页";
    if (/^🔄\uFE0F?$/.test(text.trim())) return "切换";
  }
  return type
    ? (SEARCH_RESOURCE_TYPES.find((item) => item.value === type)?.label ?? text)
    : text;
}

/** Adds familiar icons to the search bot's actions without changing callback payloads. */
function callbackButtonIcon(text: string): ReactNode {
  const resourceType = resourceTypeFromButton(text);
  if (resourceType) {
    return SEARCH_RESOURCE_TYPES.find((item) => item.value === resourceType)
      ?.icon;
  }

  if (/最新|\bnewest?\b/i.test(text)) return <ClockCircleOutlined />;
  if (/时长/.test(text)) return <ClockCircleOutlined />;
  if (/^🔄\uFE0F?$/.test(text.trim())) return <ReloadOutlined />;
  if (/过滤|\bfilter\b/i.test(text)) return <FilterOutlined />;
  if (callbackButtonLabel(text) === "下一页") return <RightOutlined />;
  if (callbackButtonLabel(text) === "首页") return <DoubleLeftOutlined />;
  if (callbackButtonLabel(text) === "上一页") return <LeftOutlined />;

  return undefined;
}

/**
 * Places all resource filters in one visual row while retaining each button's
 * original row and column. Those coordinates are required by the server to
 * resolve the matching callback data from the saved Telegram message.
 */
function groupInlineKeyboard(markup: string): GroupedInlineKeyboard {
  const resourceTypeButtons: PositionedInlineButton[] = [];
  const actionButtonRows: PositionedInlineButton[][] = [];

  inlineKeyboard(markup).forEach((buttonRow, row) => {
    const actionButtons: PositionedInlineButton[] = [];
    // Keep alternate/selected icons in their original filter row even when the bot changes their label.
    const isResourceRow = buttonRow.some(
      (button) =>
        button?.type === "CALLBACK" && resourceTypeFromButton(button.text),
    );

    buttonRow.forEach((button, column) => {
      // 无效按钮保留空位，不能改变 Telegram 回调所使用的原始列号。
      if (!button) return;
      const positionedButton = { button, row, column };
      if (isResourceRow && button.type === "CALLBACK") {
        resourceTypeButtons.push(positionedButton);
      } else {
        actionButtons.push(positionedButton);
      }
    });

    if (actionButtons.length) actionButtonRows.push(actionButtons);
  });

  return { resourceTypeButtons, actionButtonRows };
}

/** Renders the original Telegram text and turns only its matching link ranges into anchors. */
function renderMessageText(
  text: string | null,
  inlineLinks: TelegramInlineTextLink[] | undefined,
  sourceLinks: TelegramSourceLink[],
  onTelegramPostClick?: (url: string) => void,
  renderCollectionAction?: (url: string, label: string) => ReactNode,
) {
  if (!text) return "";

  const ranges = [...(inlineLinks ?? [])]
    .filter(
      (link) =>
        Number.isInteger(link.offset) &&
        Number.isInteger(link.length) &&
        link.offset >= 0 &&
        link.length > 0 &&
        link.offset + link.length <= text.length &&
        isSafeMessageLink(link.url),
    )
    .map((link) => ({
      offset: link.offset,
      length: link.length,
      url: link.url,
    }));

  // Old stored responses may predate inlineLinks; link literal URLs without changing text.
  if (!ranges.length) {
    for (const link of sourceLinks) {
      if (!isSafeMessageLink(link.url)) continue;
      const offset = text.indexOf(link.url);
      if (offset >= 0)
        ranges.push({ offset, length: link.url.length, url: link.url });
    }
  }

  const orderedRanges = ranges
    .sort((left, right) => left.offset - right.offset)
    .filter((range, index, items) => {
      const previous = items[index - 1];
      return !previous || range.offset >= previous.offset + previous.length;
    });
  if (!orderedRanges.length) return text;

  const nodes = [];
  let cursor = 0;
  for (const [index, range] of orderedRanges.entries()) {
    if (range.offset > cursor) {
      nodes.push(
        <Fragment key={`text-${cursor}`}>
          {text.slice(cursor, range.offset)}
        </Fragment>,
      );
    }
    nodes.push(
      <Fragment key={`result-${index}-${range.offset}`}>
        <a
          href={range.url}
          key={`link-${index}-${range.offset}`}
          onClick={(event) => {
            if (onTelegramPostClick && isTelegramPostLink(range.url)) {
              event.preventDefault();
              onTelegramPostClick(range.url);
            }
          }}
          rel="noopener noreferrer"
          target="_blank"
          title={range.url}
        >
          {text.slice(range.offset, range.offset + range.length)}
        </a>
        {isTelegramPostLink(range.url) &&
          renderCollectionAction?.(
            range.url,
            text.slice(range.offset, range.offset + range.length),
          )}
      </Fragment>,
    );
    cursor = range.offset + range.length;
  }
  if (cursor < text.length) {
    nodes.push(
      <Fragment key={`text-${cursor}`}>{text.slice(cursor)}</Fragment>,
    );
  }
  return nodes;
}

/** Accepts only absolute HTTP(S) message links without embedded credentials. */
function isSafeMessageLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Recognizes public Telegram post URLs, excluding channel roots, invites and bot commands. */
function isTelegramPostLink(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !["t.me", "telegram.me"].includes(host)) {
      return false;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0]?.toLowerCase() === "s") segments.shift();
    return segments.length >= 2 && /^\d+$/.test(segments.at(-1) ?? "");
  } catch {
    return false;
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
  // 草稿只保留在当前页面内存中；不同会话互不覆盖，也不持久化搜索内容。
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [conversationDrawerOpen, setConversationDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const followLatestRef = useRef(true);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [appliedTypeFilters, setAppliedTypeFilters] = useState<
    Record<number, SearchResourceType>
  >({});
  const [conversationPage, setConversationPage] = useState(1);
  const [conversationListPage, setConversationListPage] = useState(1);
  const [selectedConversationId, setSelectedConversationId] =
    useState<number>();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const keyword = selectedConversationId
    ? (drafts[selectedConversationId] ?? "")
    : "";
  const setKeyword = (value: string) => {
    if (selectedConversationId) {
      setDrafts((current) => ({ ...current, [selectedConversationId]: value }));
    }
  };
  const [workspaceTab, setWorkspaceTab] =
    useState<TelegramWorkspaceTab>("search");
  const [messageLink, setMessageLink] = useState("");
  const [collectionDateRange, setCollectionDateRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null);
  const [maxMessages, setMaxMessages] = useState(100);
  const [downloadImages, setDownloadImages] = useState(false);
  const [downloadVideos, setDownloadVideos] = useState(false);
  const [downloadDocuments, setDownloadDocuments] = useState(false);
  const [selectedCollection, setSelectedCollection] =
    useState<TelegramCollectionTask | null>(null);
  const [inlineMediaPreview, setInlineMediaPreview] = useState<{
    taskId: number;
    messageLink: string;
  } | null>(null);
  const mediaPreviewGeneration = useRef(0);
  const [resultCollections, setResultCollections] = useState<
    Record<string, TelegramCollectionTask>
  >({});
  const [collectingResult, setCollectingResult] = useState<string | null>(null);
  // The ref also blocks a second click before React has rendered the pending state.
  const resultCollectionInFlight = useRef(false);
  // A closed or replaced preview must not be reopened by an older request.
  useEffect(
    () => () => {
      mediaPreviewGeneration.current += 1;
      message.destroy("telegram-media-preview");
    },
    [message],
  );
  const [collectionTaskPage, setCollectionTaskPage] = useState(1);
  const [collectionPage, setCollectionPage] = useState(1);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [configurationForm] = Form.useForm<TelegramConfigurationForm>();

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
      resourceType?: SearchResourceType;
    }) =>
      api<CallbackAnswer>(
        `/telegram/searches/${searchId}/messages/${messageId}/buttons/${row}/${column}`,
        { method: "POST" },
        TELEGRAM_CALLBACK_TIMEOUT_MS,
      ),
    onSuccess: async (answer, request) => {
      const resourceType = request.resourceType;
      if (resourceType) {
        setAppliedTypeFilters((current) => ({
          ...current,
          [request.searchId]: resourceType,
        }));
      }
      message.info(answer.text || "机器人已处理按钮请求");
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "conversation"],
      });
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Loads persistent, owner-scoped Mayday conversations for the left sidebar. */
  const conversationList = useQuery({
    queryKey: ["telegram", "conversations", conversationListPage],
    queryFn: () =>
      api<PageResult<TelegramConversationSummary>>(
        `/telegram/conversations?page=${conversationListPage}&size=50`,
      ),
    enabled: can("telegram:view"),
    retry: false,
  });

  /** Creates one empty sidebar conversation without sending a Telegram message. */
  const createConversation = useMutation({
    mutationFn: () =>
      api<TelegramConversationSummary>("/telegram/conversations", {
        method: "POST",
      }),
    onSuccess: async (created) => {
      setConversationListPage(1);
      setConversationPage(1);
      setSelectedConversationId(created.id);
      setConversationDrawerOpen(false);
      queryClient.setQueryData<PageResult<TelegramConversationSummary>>(
        ["telegram", "conversations", 1],
        (previous) =>
          previous
            ? {
                ...previous,
                items: [
                  created,
                  ...previous.items.filter((item) => item.id !== created.id),
                ].slice(0, 50),
                total: previous.total + 1,
              }
            : { items: [created], total: 1, page: 1, size: 50 },
      );
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "conversations"],
      });
    },
    onError: (error: Error) => message.error(error.message),
  });

  /** Deletes only the selected owner's session after explicit user confirmation. */
  const deleteConversation = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/telegram/conversations/${id}`, { method: "DELETE" }),
    onSuccess: async (_, deletedId) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[deletedId];
        return next;
      });
      const listKey = [
        "telegram",
        "conversations",
        conversationListPage,
      ] as const;
      const current =
        queryClient.getQueryData<PageResult<TelegramConversationSummary>>(
          listKey,
        );
      const remaining =
        current?.items.filter((item) => item.id !== deletedId) ?? [];
      if (selectedConversationId === deletedId) {
        setSelectedConversationId(remaining[0]?.id);
        setConversationPage(1);
      }
      if (!remaining.length && conversationListPage > 1) {
        setConversationListPage((page) => Math.max(1, page - 1));
      }
      queryClient.setQueryData<PageResult<TelegramConversationSummary>>(
        listKey,
        (previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.filter((item) => item.id !== deletedId),
                total: Math.max(0, previous.total - 1),
              }
            : previous,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["telegram", "conversations"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["telegram", "conversation"],
        }),
      ]);
      message.success("会话及其本地搜索记录已删除");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const status = useQuery({
    queryKey: ["telegram", "status"],
    queryFn: () => api<TelegramStatus>("/telegram/status"),
    retry: false,
    refetchInterval: 2500,
  });

  /** Reads the active TDLib identity and bot block state only when requested. */
  const botDiagnostic = useMutation({
    mutationFn: () =>
      api<TelegramBotSessionDiagnostic>("/telegram/session/bot-diagnostic"),
    onError: (error: Error) => message.error(error.message),
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
    onSuccess: async (next, request) => {
      const phoneNumberStillPending =
        request.endpoint === "/session/phone" &&
        next.state === "WAITING_FOR_PHONE";
      if (!phoneNumberStillPending) {
        setValue("");
      }
      setFirstName("");
      setLastName("");
      queryClient.setQueryData(["telegram", "status"], next);
      await queryClient.invalidateQueries({ queryKey: ["telegram", "status"] });
      if (phoneNumberStillPending) {
        message.info(
          "手机号已提交，正在等待 Telegram 返回授权结果；号码会保留，便于出错后修改重试。",
        );
      } else {
        message.success(next.message);
      }
    },
    onError: (error: Error) => message.error(error.message),
  });

  const view = status.data;
  const authorizationState = view?.state;
  useEffect(() => {
    // A credential is kept only while Telegram remains on the same challenge, so
    // a rejected phone can be corrected but never carries over into the code step.
    setValue("");
    setFirstName("");
    setLastName("");
  }, [authorizationState]);
  const canConfigure = can("telegram:configure");
  const configuration = useQuery({
    queryKey: ["telegram", "configuration"],
    queryFn: () => api<TelegramConfigurationView>("/telegram/configuration"),
    enabled: configurationOpen && canConfigure,
    retry: false,
  });
  const saveConfiguration = useMutation({
    mutationFn: (values: TelegramConfigurationForm) =>
      api<TelegramConfigurationView>("/telegram/configuration", {
        method: "PUT",
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      message.success("Telegram 配置已保存，将立即用于下一次连接");
      setConfigurationOpen(false);
      configurationForm.resetFields();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["telegram", "status"] }),
        queryClient.invalidateQueries({
          queryKey: ["telegram", "configuration"],
        }),
      ]);
    },
    onError: (error: Error) => message.error(error.message),
  });

  useEffect(() => {
    if (!configurationOpen || !configuration.data) return;
    configurationForm.setFieldsValue({
      apiId: configuration.data.apiId,
      apiHash: "",
      proxyEnabled: configuration.data.proxyEnabled,
      proxyType: configuration.data.proxyType,
      proxyHost: configuration.data.proxyHost,
      proxyPort: configuration.data.proxyPort,
      proxyUsername: configuration.data.proxyUsername,
      proxyPassword: "",
      proxySecret: "",
    });
  }, [configuration.data, configurationOpen, configurationForm]);
  const challenge = view ? CHALLENGES[view.state] : undefined;
  const canConnect = can("telegram:connect");
  const canClose = can("telegram:disconnect");
  const canLogOut = can("telegram:logout");
  const isBusy = action.isPending;

  /** Selects the newest session on first load, while preserving the user's current selection. */
  useEffect(() => {
    if (!conversationList.isSuccess) return;
    const conversations = conversationList.data.items;
    if (!conversations.length) {
      setSelectedConversationId(undefined);
      return;
    }
    if (!conversations.some((item) => item.id === selectedConversationId)) {
      setSelectedConversationId(conversations[0].id);
      setConversationPage(1);
    }
  }, [
    conversationList.data,
    conversationList.isSuccess,
    selectedConversationId,
  ]);

  /** Loads one selected session page, including reply-specific links, without mixing other sessions. */
  const conversation = useQuery({
    queryKey: [
      "telegram",
      "conversation",
      selectedConversationId,
      conversationPage,
    ],
    queryFn: () =>
      api<PageResult<TelegramConversationTurn>>(
        `/telegram/conversation?conversationId=${selectedConversationId}&page=${conversationPage}&size=20`,
      ),
    enabled: Boolean(view && can("telegram:view") && selectedConversationId),
    refetchInterval: (query) =>
      query.state.data?.items.some((turn) =>
        ["PENDING", "SENDING", "WAITING"].includes(turn.search.status),
      )
        ? 2500
        : false,
    retry: false,
  });

  /** 高度随可用视口调整，保留外部导航与页脚；只让消息区域滚动。 */
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || workspaceTab !== "search") return;
    const updateHeight = () => {
      const top = workspace.getBoundingClientRect().top + window.scrollY;
      const footer = document.querySelector(".admin-footer");
      const footerHeight = footer?.getBoundingClientRect().height ?? 40;
      const viewportHeight =
        window.visualViewport?.height ?? window.innerHeight;
      workspace.style.setProperty(
        "--telegram-workspace-height",
        `${Math.max(140, viewportHeight - top - footerHeight - 28)}px`,
      );
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("resize", updateHeight);
    };
  }, [workspaceTab, can("telegram:view")]);

  /** 切换会话定位到最新消息；翻阅历史时保持当前位置，避免轮询抢走阅读焦点。 */
  useEffect(() => {
    followLatestRef.current = conversationPage === 1;
    setShowScrollLatest(false);
    if (transcriptRef.current) transcriptRef.current.scrollTop = 0;
  }, [selectedConversationId, conversationPage, workspaceTab]);

  const newestTurn = conversation.data?.items[0];
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript || conversationPage !== 1 || !newestTurn) return;
    if (followLatestRef.current) {
      transcript.scrollTop = transcript.scrollHeight;
      setShowScrollLatest(false);
    }
  }, [
    conversationPage,
    selectedConversationId,
    conversation.data,
    workspaceTab,
  ]);

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
          messageLink: messageLink.trim(),
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

  /** Previews the linked post and its album without collecting unrelated channel history. */
  const createInlineMediaPreview = useMutation({
    onMutate: () => ++mediaPreviewGeneration.current,
    mutationFn: (link: string) =>
      api<TelegramCollectionTask>("/telegram/collections", {
        method: "POST",
        body: JSON.stringify({
          messageLink: link,
          maxMessages: 10,
          includeAlbum: true,
          previewOnly: true,
          downloadImages: true,
          downloadVideos: true,
          downloadDocuments: true,
        }),
      }),
    onSuccess: (task, link, generation) => {
      setResultCollections((current) => ({ ...current, [link]: task }));
      void queryClient.invalidateQueries({
        queryKey: ["telegram", "collections"],
      });
      if (generation !== mediaPreviewGeneration.current) return;
      message.destroy("telegram-media-preview");
      setInlineMediaPreview({
        taskId: task.id,
        messageLink: task.messageLink ?? link,
      });
      setCollectionTaskPage(1);
    },
    onError: (error: Error, _link, generation) => {
      if (generation !== mediaPreviewGeneration.current) return;
      message.destroy("telegram-media-preview");
      message.error(error.message);
    },
  });

  /** Collects one search result and its album directly, leaving the conversation in place. */
  const collectSearchResult = useMutation({
    mutationFn: (link: string) =>
      api<TelegramCollectionTask>("/telegram/collections", {
        method: "POST",
        body: JSON.stringify({
          messageLink: link,
          maxMessages: 10,
          includeAlbum: true,
          downloadImages: true,
          downloadVideos: true,
          downloadDocuments: true,
        }),
      }),
    onSuccess: (task, link) => {
      setResultCollections((current) => ({ ...current, [link]: task }));
      setCollectionTaskPage(1);
      void queryClient.invalidateQueries({
        queryKey: ["telegram", "collections"],
      });
      message.success("已加入采集，可点击“查看采集”查看进度和附件");
    },
    onError: (error: Error) => message.error(error.message),
    onSettled: () => {
      resultCollectionInFlight.current = false;
      setCollectingResult(null);
    },
  });

  /** Provides a visible action only for message links; channel roots never imply a history crawl. */
  const renderResultCollectionAction = (link: string, label: string) => {
    if (!can("telegram:collect") || !can("telegram:download")) return null;
    const task = resultCollections[link];
    return (
      <Button
        className="telegram-result-collect"
        type="text"
        size="small"
        icon={task ? <CheckCircleOutlined /> : <DownloadOutlined />}
        loading={collectingResult === link}
        disabled={
          !view?.connected ||
          Boolean(collectingResult && collectingResult !== link) ||
          createInlineMediaPreview.isPending
        }
        aria-label={`${task ? "查看采集" : "采集"}：${label}`}
        title="保存该消息及同一相册的图片、视频和文件"
        onClick={() => {
          if (task) {
            setInlineMediaPreview({ taskId: task.id, messageLink: link });
            return;
          }
          if (resultCollectionInFlight.current) return;
          resultCollectionInFlight.current = true;
          setCollectingResult(link);
          collectSearchResult.mutate(link);
        }}
      >
        {task ? "查看采集" : "采集"}
      </Button>
    );
  };

  /** Enforces account and permission checks before turning a Telegram post link into a local preview. */
  const previewTelegramPost = (link: string) => {
    if (!view?.connected) {
      message.warning("请先连接 Telegram 账号，再预览帖子媒体");
      return;
    }
    if (
      !can("telegram:view") ||
      !can("telegram:collect") ||
      !can("telegram:download")
    ) {
      message.warning(
        "预览媒体需要“查看”、“采集”和“下载”权限，请联系管理员配置",
      );
      return;
    }
    if (
      createInlineMediaPreview.isPending ||
      inlineMediaPreview ||
      resultCollectionInFlight.current
    ) {
      return;
    }
    const existingTask = resultCollections[link];
    if (existingTask) {
      setInlineMediaPreview({ taskId: existingTask.id, messageLink: link });
      return;
    }
    message.loading({
      content: "正在准备图片 / 视频预览…",
      key: "telegram-media-preview",
      duration: 0,
    });
    createInlineMediaPreview.mutate(link);
  };

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
      setResultCollections((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, task]) => task.id !== id),
        ),
      );
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

  /** Sends one deliberate search only after the user confirms the keyword in this page. */
  const search = useMutation({
    mutationFn: ({
      query,
      conversationId,
    }: {
      query: string;
      conversationId: number;
    }) =>
      api<TelegramSearch>("/telegram/searches", {
        method: "POST",
        body: JSON.stringify({ keyword: query, conversationId }),
      }),
    onSuccess: async (_created, request) => {
      // 只清除本次已发送的草稿，不误清切换会话后输入的新内容。
      setDrafts((current) =>
        current[request.conversationId]?.trim() === request.query
          ? { ...current, [request.conversationId]: "" }
          : current,
      );
      if (selectedConversationId === request.conversationId) {
        followLatestRef.current = true;
        setConversationPage(1);
      }
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "conversation"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["telegram", "conversations"],
      });
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

  /** Submits a user-confirmed keyword to the configured Telegram search bot. */
  function submitSearch() {
    const query = keyword.trim();
    if (!query || search.isPending) return;
    if (!selectedConversationId) {
      message.info("请先新建或选择一个会话");
      return;
    }
    search.mutate({ query, conversationId: selectedConversationId });
  }

  const selectedConversation = conversationList.data?.items.find(
    (item) => item.id === selectedConversationId,
  );
  const sidebar = (
    <TelegramConversationSidebar
      items={conversationList.data?.items ?? []}
      total={conversationList.data?.total ?? 0}
      page={conversationListPage}
      selectedId={selectedConversationId}
      loading={conversationList.isPending}
      error={
        conversationList.isError ? conversationList.error.message : undefined
      }
      canCreate={can("telegram:search")}
      canDelete={can("telegram:delete")}
      creating={createConversation.isPending}
      deletingId={
        deleteConversation.isPending ? deleteConversation.variables : undefined
      }
      onCreate={() => createConversation.mutate()}
      onSelect={(id) => {
        setSelectedConversationId(id);
        setConversationPage(1);
        setConversationDrawerOpen(false);
      }}
      onDelete={(item) =>
        modal.confirm({
          title: "删除这个对话？",
          content:
            "将删除这个对话的本地搜索记录和回复，Telegram 中的消息不受影响。",
          okText: "删除对话",
          cancelText: "取消",
          okButtonProps: { danger: true },
          onOk: () => deleteConversation.mutateAsync(item.id),
        })
      }
      onRetry={() => void conversationList.refetch()}
      onPageChange={setConversationListPage}
    />
  );

  return (
    <Space
      className="telegram-page"
      direction="vertical"
      size={16}
      style={{ display: "flex" }}
    >
      <Tabs
        className="telegram-workspace-tabs"
        activeKey={workspaceTab}
        onChange={(key) => setWorkspaceTab(key as TelegramWorkspaceTab)}
        items={[
          { key: "search", label: "极搜" },
          ...(can("telegram:collect")
            ? [{ key: "channels", label: "频道" }]
            : []),
          { key: "collection", label: "采集记录" },
          { key: "account", label: "账号与连接" },
        ]}
      />

      {workspaceTab === "account" && (
        <Card className="telegram-account-card">
          <div className="telegram-account-toolbar">
            <Space>
              {view?.connected &&
                view.state === "READY" &&
                can("telegram:view") && (
                  <Space wrap>
                    <Button
                      icon={<ScanOutlined />}
                      loading={botDiagnostic.isPending}
                      onClick={() => botDiagnostic.mutate()}
                    >
                      检查机器人会话
                    </Button>
                  </Space>
                )}
              {canConfigure ? (
                <Button
                  icon={<SettingOutlined />}
                  onClick={() => setConfigurationOpen(true)}
                >
                  配置
                </Button>
              ) : null}
              <Button
                aria-label="刷新 Telegram 状态"
                icon={<ReloadOutlined />}
                onClick={() => void status.refetch()}
              />
            </Space>
          </div>
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
              {view.state !== "READY" && (
                <Alert
                  type={view.state === "ERROR" ? "error" : "info"}
                  showIcon
                  message={view.message}
                />
              )}
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 2, lg: 3 }}
                style={{ marginTop: 12 }}
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
                      : canConfigure
                        ? "点击配置"
                        : "请联系管理员配置",
                  },
                  {
                    key: "encryption",
                    label: "会话加密",
                    children: view.encryptionKeyConfigured
                      ? "密钥已配置"
                      : canConfigure
                        ? "保存配置时自动生成"
                        : "请联系管理员配置",
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
              {view.connected &&
              view.state === "READY" &&
              can("telegram:view") &&
              botDiagnostic.data ? (
                <Space
                  direction="vertical"
                  size={12}
                  style={{ display: "flex", marginTop: 20 }}
                >
                  {botDiagnostic.data ? (
                    <Alert
                      type={
                        botDiagnostic.data.onlineMainBlockListStatus ===
                        "BLOCKED"
                          ? "warning"
                          : "info"
                      }
                      showIcon
                      message={
                        botDiagnostic.data.onlineMainBlockListStatus ===
                        "BLOCKED"
                          ? "Telegram 在线主屏蔽列表包含该机器人"
                          : botDiagnostic.data.onlineMainBlockListStatus ===
                              "NOT_BLOCKED"
                            ? "Telegram 在线主屏蔽列表未包含该机器人"
                            : "未能完整核对 Telegram 在线主屏蔽列表"
                      }
                      description={
                        <Space direction="vertical" size={10}>
                          {botDiagnostic.data.onlineMainBlockListStatus ===
                          "BLOCKED" ? (
                            <Typography.Paragraph style={{ marginBottom: 0 }}>
                              已定位极搜发送失败的原因：当前 Telegram
                              账号的在线屏蔽列表包含 @
                              {botDiagnostic.data.botUsername}。请在 Telegram
                              打开该机器人的私聊并解除屏蔽，然后回到此页重新检查并搜索。解除前，Mayday
                              无法代替 Telegram 发送关键词。
                            </Typography.Paragraph>
                          ) : null}
                          <Descriptions
                            size="small"
                            column={{ xs: 1, sm: 2, lg: 3 }}
                            items={[
                              {
                                key: "currentUser",
                                label: "当前 Telegram 用户 ID",
                                children: botDiagnostic.data.telegramUserId,
                              },
                              {
                                key: "botUsername",
                                label: "配置的机器人",
                                children: `@${botDiagnostic.data.botUsername}`,
                              },
                              {
                                key: "botUser",
                                label: "机器人用户 ID",
                                children: botDiagnostic.data.botUserId,
                              },
                              {
                                key: "botChat",
                                label: "机器人私聊 ID",
                                children: botDiagnostic.data.botChatId,
                              },
                              {
                                key: "onlineBlockList",
                                label: "在线主屏蔽列表核对",
                                children:
                                  botDiagnostic.data
                                    .onlineMainBlockListStatus === "BLOCKED"
                                    ? "包含该机器人"
                                    : botDiagnostic.data
                                          .onlineMainBlockListStatus ===
                                        "NOT_BLOCKED"
                                      ? "不包含该机器人"
                                      : "检查范围达到安全上限，结果不完整",
                              },
                              {
                                key: "cachedBlockList",
                                label: "TDLib 本地聊天缓存",
                                children:
                                  botDiagnostic.data.cachedBlockListType,
                              },
                            ]}
                          />
                        </Space>
                      }
                    />
                  ) : null}
                </Space>
              ) : null}
            </>
          ) : null}
          {workspaceTab === "account" &&
            view &&
            (!view.credentialsConfigured || !view.encryptionKeyConfigured) && (
              <Alert
                type="warning"
                showIcon
                message="还不能发起账号授权"
                description={
                  canConfigure
                    ? "点击本页顶部“配置”填写 Telegram API 凭据；会话加密密钥由服务端自动生成并安全保存。"
                    : "请联系拥有 Telegram 配置权限的管理员完成 API 凭据设置。"
                }
              />
            )}

          {workspaceTab === "account" &&
            view &&
            canConnect &&
            view.credentialsConfigured &&
            view.encryptionKeyConfigured && (
              <div className="telegram-account-authorization">
                {challenge ? (
                  <Form
                    layout="vertical"
                    onFinish={submitChallenge}
                    style={{ maxWidth: 560 }}
                    autoComplete="off"
                  >
                    <Form.Item
                      label={challenge.label}
                      required
                      extra={
                        view.state === "WAITING_FOR_PHONE"
                          ? "用于登录 Telegram 用户账号，不是 Mayday 的手机号验证；验证码由 Telegram 决定发送方式。"
                          : undefined
                      }
                    >
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
                    {/* 授权挑战期间保留安全断开入口，便于调整代理等运行配置；关闭连接不会退出账号。 */}
                    <Space wrap>
                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={isBusy}
                        disabled={!value.trim()}
                      >
                        提交并继续
                      </Button>
                      {view.connected && canClose && (
                        <Button
                          htmlType="button"
                          icon={<DisconnectOutlined />}
                          loading={isBusy}
                          onClick={() =>
                            action.mutate({ endpoint: "/session/close" })
                          }
                        >
                          关闭连接并保留会话
                        </Button>
                      )}
                    </Space>
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
                              action.mutateAsync({
                                endpoint: "/session/logout",
                              }),
                          })
                        }
                      >
                        退出 Telegram 账号
                      </Button>
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
              </div>
            )}
        </Card>
      )}

      {workspaceTab === "account" && canConfigure && (
        <TelegramMediaPolicySettings />
      )}

      <Modal
        title="Telegram 连接配置"
        open={configurationOpen}
        width={680}
        destroyOnHidden
        confirmLoading={saveConfiguration.isPending}
        okText="保存配置"
        cancelText="取消"
        onCancel={() => {
          setConfigurationOpen(false);
          configurationForm.resetFields();
        }}
        onOk={() => void configurationForm.submit()}
      >
        {configuration.isLoading ? (
          <Typography.Text type="secondary">正在读取安全配置…</Typography.Text>
        ) : configuration.error ? (
          <Alert type="error" showIcon message={configuration.error.message} />
        ) : configuration.data ? (
          <>
            {!configuration.data.encryptionAvailable && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 20 }}
                message="无法保存凭据：尚未配置平台加密密钥"
                description="请联系管理员配置 MAYDAY_IDENTITY_ENCRYPTION_KEY。"
              />
            )}
            <Form<TelegramConfigurationForm>
              form={configurationForm}
              layout="vertical"
              onFinish={(values) => saveConfiguration.mutate(values)}
              disabled={
                saveConfiguration.isPending ||
                !configuration.data.encryptionAvailable
              }
            >
              <Form.Item
                name="apiId"
                label="Telegram API ID"
                rules={[
                  { required: true, message: "请输入 Telegram API ID" },
                  {
                    pattern: /^[1-9][0-9]{0,9}$/,
                    message: "API ID 必须是正整数",
                  },
                ]}
              >
                <Input
                  inputMode="numeric"
                  placeholder="从 Telegram 开发者页面获取"
                />
              </Form.Item>
              <Form.Item
                name="apiHash"
                label="Telegram API Hash"
                extra={
                  configuration.data.apiHashConfigured
                    ? "已保存；留空保持当前值，输入新值即可替换。"
                    : "必填；保存后不会再次显示。"
                }
                rules={[
                  { max: 512, message: "API Hash 长度不能超过 512 个字符" },
                ]}
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={
                    configuration.data.apiHashConfigured
                      ? "留空保持当前 API Hash"
                      : "输入 Telegram API Hash"
                  }
                />
              </Form.Item>
              <Form.Item name="proxyEnabled" valuePropName="checked">
                <Checkbox>通过 Telegram 代理连接</Checkbox>
              </Form.Item>
              <Form.Item noStyle shouldUpdate>
                {({ getFieldValue }) =>
                  getFieldValue("proxyEnabled") ? (
                    <>
                      <Form.Item
                        name="proxyType"
                        label="代理类型"
                        rules={[{ required: true }]}
                      >
                        <Select
                          options={[
                            { value: "socks5", label: "SOCKS5" },
                            { value: "http", label: "HTTP CONNECT" },
                            { value: "mtproto", label: "MTProto" },
                          ]}
                        />
                      </Form.Item>
                      <Space style={{ display: "flex" }} align="start">
                        <Form.Item
                          name="proxyHost"
                          label="代理主机"
                          style={{ flex: 1 }}
                          rules={[
                            { required: true, message: "请输入代理主机" },
                          ]}
                        >
                          <Input placeholder="proxy.example.com" />
                        </Form.Item>
                        <Form.Item
                          name="proxyPort"
                          label="端口"
                          rules={[
                            { required: true, message: "请输入代理端口" },
                          ]}
                        >
                          <InputNumber
                            min={1}
                            max={65535}
                            style={{ width: 120 }}
                          />
                        </Form.Item>
                      </Space>
                      {getFieldValue("proxyType") === "mtproto" ? (
                        <Form.Item
                          name="proxySecret"
                          label="MTProto Secret"
                          extra={
                            configuration.data.proxySecretConfigured
                              ? "已保存；留空保持当前值。"
                              : undefined
                          }
                          rules={[
                            {
                              max: 512,
                              message: "Secret 长度不能超过 512 个字符",
                            },
                          ]}
                        >
                          <Input.Password
                            autoComplete="new-password"
                            placeholder="输入 MTProto Secret"
                          />
                        </Form.Item>
                      ) : (
                        <>
                          <Form.Item name="proxyUsername" label="代理用户名">
                            <Input autoComplete="off" />
                          </Form.Item>
                          <Form.Item
                            name="proxyPassword"
                            label="代理密码"
                            extra={
                              configuration.data.proxyPasswordConfigured
                                ? "已保存；留空保持当前值。"
                                : undefined
                            }
                            rules={[
                              {
                                max: 255,
                                message: "代理密码长度不能超过 255 个字符",
                              },
                            ]}
                          >
                            <Input.Password
                              autoComplete="new-password"
                              placeholder="输入代理密码（可选）"
                            />
                          </Form.Item>
                        </>
                      )}
                    </>
                  ) : null
                }
              </Form.Item>
            </Form>
          </>
        ) : null}
      </Modal>

      {workspaceTab === "search" &&
        (!can("telegram:view") ? (
          <Alert
            type="warning"
            showIcon
            message="当前账号没有查看 Telegram 消息的权限"
            description="请联系管理员授予 Telegram 查看权限。"
          />
        ) : (
          <div
            className={`telegram-chat-workspace${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
            ref={workspaceRef}
          >
            <div className="telegram-chat-desktop-sidebar">{sidebar}</div>
            <Drawer
              title="对话"
              placement="left"
              width="min(320px, 90vw)"
              open={conversationDrawerOpen}
              onClose={() => setConversationDrawerOpen(false)}
              rootClassName="telegram-conversation-drawer"
              styles={{ body: { padding: 0 } }}
            >
              {sidebar}
            </Drawer>
            <section
              className={`telegram-chat-panel${conversation.isSuccess && !conversation.data.items.length ? " is-empty-conversation" : ""}`}
              aria-label="极搜对话"
            >
              <header className="telegram-chat-header">
                <div className="telegram-chat-heading">
                  <Button
                    type="text"
                    className="telegram-chat-desktop-toggle"
                    icon={<MenuOutlined />}
                    aria-label={
                      sidebarCollapsed ? "展开对话列表" : "收起对话列表"
                    }
                    title={sidebarCollapsed ? "展开对话列表" : "收起对话列表"}
                    onClick={() => setSidebarCollapsed((value) => !value)}
                  />
                  <Button
                    type="text"
                    className="telegram-chat-mobile-toggle"
                    icon={<MenuOutlined />}
                    aria-label="打开对话列表"
                    onClick={() => setConversationDrawerOpen(true)}
                  />
                  <div className="telegram-chat-heading-copy">
                    <Typography.Text strong ellipsis>
                      {selectedConversation?.title ?? "极搜"}
                    </Typography.Text>
                    <span className="telegram-chat-connection">
                      <span className={view?.connected ? "is-connected" : ""} />
                      {view?.connected
                        ? newestTurn?.search.botUsername
                          ? `@${newestTurn.search.botUsername}`
                          : "Telegram 已连接"
                        : "未连接 Telegram"}
                    </span>
                  </div>
                </div>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  aria-label="新建对话"
                  title="新建对话"
                  loading={createConversation.isPending}
                  disabled={!can("telegram:search")}
                  onClick={() => createConversation.mutate()}
                />
              </header>
              {!view?.connected ? (
                <Alert
                  className="telegram-chat-error"
                  type="info"
                  showIcon
                  message="连接 Telegram 后即可发起极搜"
                  description="历史会话仍可查看。完成账号授权后，可在当前会话中继续搜索。"
                  action={
                    <Button onClick={() => setWorkspaceTab("account")}>
                      前往账号与连接
                    </Button>
                  }
                />
              ) : !can("telegram:search") ? (
                <Alert
                  className="telegram-chat-error"
                  type="warning"
                  showIcon
                  message="当前账号仅可查看历史对话"
                  description="如需发起搜索或操作机器人按钮，请联系管理员授予 Telegram 搜索权限。"
                />
              ) : null}

              {conversation.isError ? (
                <Alert
                  className="telegram-chat-error"
                  type="error"
                  showIcon
                  message="对话读取失败"
                  description={conversation.error.message}
                  action={
                    <Button
                      size="small"
                      onClick={() => void conversation.refetch()}
                    >
                      重试
                    </Button>
                  }
                />
              ) : null}

              <div
                className={`telegram-chat-transcript${conversation.data?.items.length ? "" : " is-empty"}`}
                aria-label="对话消息"
                ref={transcriptRef}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  const nearBottom =
                    node.scrollHeight - node.scrollTop - node.clientHeight < 80;
                  followLatestRef.current = nearBottom;
                  setShowScrollLatest(!nearBottom);
                }}
              >
                {!selectedConversationId ? (
                  <div className="telegram-chat-empty">
                    <div className="telegram-chat-empty-icon">
                      <MessageOutlined />
                    </div>
                    <h2>想找点什么？</h2>
                    <p>搜索频道、图片、视频和文件，结果都留在对话里。</p>
                    <Button
                      type="primary"
                      icon={<EditOutlined />}
                      disabled={!can("telegram:search")}
                      loading={createConversation.isPending}
                      onClick={() => createConversation.mutate()}
                    >
                      新建对话
                    </Button>
                  </div>
                ) : conversation.isPending ? (
                  <Typography.Text type="secondary">
                    正在读取对话…
                  </Typography.Text>
                ) : conversation.data?.items.length ? (
                  <>
                    {conversation.data.items
                      .slice()
                      .reverse()
                      .map((turn) => (
                        <article
                          className="telegram-chat-turn"
                          key={turn.search.id}
                        >
                          <div className="telegram-chat-turn-heading">
                            <time>
                              {dayjs(turn.search.createdAt).format(
                                "YYYY-MM-DD HH:mm",
                              )}
                            </time>
                            {appliedTypeFilters[turn.search.id] ? (
                              <Tag>
                                已筛选
                                {SEARCH_RESOURCE_TYPES.find(
                                  (item) =>
                                    item.value ===
                                    appliedTypeFilters[turn.search.id],
                                )?.label ?? "所选类型"}
                              </Tag>
                            ) : null}
                          </div>

                          <div className="telegram-chat-message is-outgoing">
                            <div className="telegram-chat-bubble">
                              {turn.search.keyword}
                            </div>
                          </div>

                          {turn.messages.map((row) => {
                            const keyboard = groupInlineKeyboard(
                              row.replyMarkupJson,
                            );
                            const sentAt =
                              row.telegramEditedAt ?? row.telegramSentAt;
                            const hasKeyboard =
                              keyboard.resourceTypeButtons.length > 0 ||
                              keyboard.actionButtonRows.length > 0;
                            const renderButton = ({
                              button,
                              row: buttonRow,
                              column,
                            }: PositionedInlineButton) => {
                              const key = `${row.id}-${buttonRow}-${column}`;

                              if (button.type === "CALLBACK") {
                                const selectedType = resourceTypeFromButton(
                                  button.text,
                                );
                                const isPending =
                                  callback.isPending &&
                                  callback.variables?.searchId ===
                                    turn.search.id &&
                                  callback.variables.messageId === row.id &&
                                  callback.variables.row === buttonRow &&
                                  callback.variables.column === column;

                                return (
                                  <Button
                                    key={key}
                                    className={
                                      selectedType
                                        ? "telegram-chat-resource-button"
                                        : undefined
                                    }
                                    aria-pressed={
                                      selectedType
                                        ? appliedTypeFilters[turn.search.id] ===
                                          selectedType
                                        : undefined
                                    }
                                    title={
                                      selectedType
                                        ? `筛选这条回复中的${callbackButtonLabel(button.text)}`
                                        : undefined
                                    }
                                    size="small"
                                    aria-label={callbackButtonLabel(
                                      button.text,
                                    )}
                                    icon={callbackButtonIcon(button.text)}
                                    loading={isPending}
                                    disabled={
                                      !view?.connected ||
                                      !can("telegram:search") ||
                                      callback.isPending
                                    }
                                    onClick={() =>
                                      callback.mutate({
                                        searchId: turn.search.id,
                                        messageId: row.id,
                                        row: buttonRow,
                                        column,
                                        ...(selectedType
                                          ? { resourceType: selectedType }
                                          : {}),
                                      })
                                    }
                                  >
                                    {callbackButtonLabel(button.text)}
                                  </Button>
                                );
                              }

                              if (
                                button.type === "URL" &&
                                isSafeHttpsUrl(button.url)
                              ) {
                                return (
                                  <Fragment key={key}>
                                    <Button
                                      key={key}
                                      size="small"
                                      href={button.url}
                                      onClick={(event) => {
                                        if (isTelegramPostLink(button.url!)) {
                                          event.preventDefault();
                                          previewTelegramPost(button.url!);
                                        }
                                      }}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {button.text}
                                    </Button>
                                    {isTelegramPostLink(button.url!) &&
                                      renderResultCollectionAction(
                                        button.url!,
                                        button.text,
                                      )}
                                  </Fragment>
                                );
                              }

                              return null;
                            };
                            return (
                              <div
                                className="telegram-chat-message is-incoming"
                                key={row.id}
                              >
                                <div className="telegram-chat-message-label">
                                  <span className="telegram-chat-bot-avatar">
                                    <SearchOutlined />
                                  </span>
                                  <strong>极搜</strong>
                                  <span>@{turn.search.botUsername}</span>
                                  {sentAt ? (
                                    <time>{dayjs(sentAt).format("HH:mm")}</time>
                                  ) : null}
                                </div>
                                <div className="telegram-chat-bubble">
                                  <Typography.Paragraph className="telegram-chat-message-content">
                                    {renderMessageText(
                                      row.messageText,
                                      row.inlineLinks,
                                      row.sourceLinks,
                                      previewTelegramPost,
                                      renderResultCollectionAction,
                                    ) || `（${row.contentType}，无文本内容）`}
                                  </Typography.Paragraph>

                                  {hasKeyboard || row.messageText ? (
                                    <div
                                      className="telegram-chat-inline-keyboard"
                                      aria-label="回复操作"
                                      role="group"
                                    >
                                      {keyboard.resourceTypeButtons.map(
                                        renderButton,
                                      )}
                                      <div className="telegram-chat-action-row">
                                        {keyboard.actionButtonRows.flatMap(
                                          (buttonRow) =>
                                            buttonRow.map(renderButton),
                                        )}
                                        {row.messageText ? (
                                          <Button
                                            className="telegram-chat-copy-button"
                                            type="text"
                                            size="small"
                                            icon={<CopyOutlined />}
                                            aria-label="复制回复"
                                            title="复制回复"
                                            onClick={() => {
                                              void navigator.clipboard
                                                .writeText(row.messageText!)
                                                .then(
                                                  () =>
                                                    message.success(
                                                      "已复制回复",
                                                    ),
                                                  () =>
                                                    message.error(
                                                      "复制失败，请选中文字复制",
                                                    ),
                                                );
                                            }}
                                          />
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}

                          {["PENDING", "SENDING", "WAITING"].includes(
                            turn.search.status,
                          ) ? (
                            <div
                              className="telegram-chat-waiting"
                              role="status"
                            >
                              <span
                                className="telegram-chat-typing-indicator"
                                aria-hidden="true"
                              />
                              <span>
                                {turn.search.statusMessage ||
                                  "正在等待 Telegram 机器人回复…"}
                              </span>
                            </div>
                          ) : ["FAILED", "TIMEOUT"].includes(
                              turn.search.status,
                            ) ? (
                            <Typography.Text
                              className="telegram-chat-status-message"
                              type="danger"
                            >
                              {turn.search.statusMessage ||
                                searchStatusLabel(turn.search.status)}
                            </Typography.Text>
                          ) : null}
                        </article>
                      ))}
                  </>
                ) : (
                  <div className="telegram-chat-empty">
                    <div className="telegram-chat-empty-icon">
                      <SearchOutlined />
                    </div>
                    <h2>想找点什么？</h2>
                    <p>输入关键词开始搜索，收到回复后可按资源类型筛选。</p>
                    <div
                      className="telegram-chat-empty-types"
                      aria-label="可搜索的资源"
                    >
                      <span>
                        <TeamOutlined />
                        群组与频道
                      </span>
                      <span>
                        <PictureOutlined />
                        图片
                      </span>
                      <span>
                        <VideoCameraOutlined />
                        视频
                      </span>
                      <span>
                        <FolderOutlined />
                        文件
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {conversation.data && conversation.data.total > 20 ? (
                <div className="telegram-chat-pagination">
                  <Typography.Text type="secondary">
                    第 {conversationPage} 页 · 共 {conversation.data.total}{" "}
                    次搜索
                  </Typography.Text>
                  <Space>
                    <Button
                      disabled={conversationPage <= 1}
                      onClick={() =>
                        setConversationPage((page) => Math.max(1, page - 1))
                      }
                    >
                      较新消息
                    </Button>
                    <Button
                      disabled={
                        conversationPage * 20 >= conversation.data.total
                      }
                      onClick={() => setConversationPage((page) => page + 1)}
                    >
                      更早消息
                    </Button>
                  </Space>
                </div>
              ) : null}

              <div className="telegram-chat-composer">
                {showScrollLatest && (
                  <Button
                    className="telegram-chat-scroll-latest"
                    shape="circle"
                    icon={<ArrowDownOutlined />}
                    aria-label="滚动到最新消息"
                    title="滚动到最新消息"
                    onClick={() => {
                      const transcript = transcriptRef.current;
                      if (transcript)
                        transcript.scrollTop = transcript.scrollHeight;
                      followLatestRef.current = true;
                      setShowScrollLatest(false);
                    }}
                  />
                )}
                <div className="telegram-chat-composer-box">
                  <Input.TextArea
                    aria-label="极搜关键词"
                    value={keyword}
                    maxLength={256}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    variant="borderless"
                    placeholder="发送关键词给极搜…"
                    onChange={(event) => setKeyword(event.target.value)}
                    disabled={
                      !view?.connected ||
                      !can("telegram:search") ||
                      !selectedConversationId
                    }
                    onPressEnter={(event) => {
                      if (event.shiftKey || event.nativeEvent.isComposing)
                        return;
                      event.preventDefault();
                      submitSearch();
                    }}
                  />
                  <div className="telegram-chat-composer-tools">
                    <span>
                      <SearchOutlined />
                      极搜搜索
                    </span>
                    <div className="telegram-chat-send-tools">
                      <span className="telegram-chat-shortcut">Enter 发送</span>
                      <Button
                        type="primary"
                        shape="circle"
                        aria-label="发送"
                        title="发送"
                        icon={<ArrowUpOutlined />}
                        loading={search.isPending}
                        disabled={
                          !keyword.trim() ||
                          search.isPending ||
                          !view?.connected ||
                          !can("telegram:search") ||
                          !selectedConversationId
                        }
                        onClick={submitSearch}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ))}

      {workspaceTab === "channels" && view && can("telegram:collect") && (
        <TelegramChannelBrowser
          connected={view.state === "READY"}
          onPreview={previewTelegramPost}
          onConnection={() => setWorkspaceTab("account")}
          onRecords={() => setWorkspaceTab("collection")}
        />
      )}

      {workspaceTab === "collection" && view && can("telegram:view") && (
        <Card className="telegram-collection-panel">
          {can("telegram:collect") ? (
            <Space
              direction="vertical"
              size={12}
              style={{ width: "100%", marginBottom: 20 }}
            >
              <Space wrap align="center">
                <Input
                  aria-label="Telegram 消息链接"
                  placeholder="粘贴 t.me 消息链接"
                  value={messageLink}
                  onChange={(event) => setMessageLink(event.target.value)}
                  style={{ width: 340 }}
                  maxLength={2048}
                />
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
                  disabled={!messageLink.trim()}
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
            className="telegram-collection-table"
            rowKey="id"
            columns={[
              {
                title: "序号",
                width: 64,
                align: "center",
                render: (_, _task, index) =>
                  (collectionTaskPage - 1) * 10 + index + 1,
              },
              {
                title: "采集内容",
                dataIndex: "sourceTitle",
                ellipsis: true,
                render: (_title: string | null, task) => (
                  <div className="telegram-collection-source">
                    <Typography.Text
                      strong
                      ellipsis
                      title={task.sourceTitle || undefined}
                    >
                      {task.sourceTitle ||
                        (task.messageLink ? "未获取到标题" : "已加入频道")}
                    </Typography.Text>
                    {task.messageLink ? (
                      <Typography.Text type="secondary" copyable ellipsis>
                        {task.messageLink}
                      </Typography.Text>
                    ) : null}
                    {task.fromDate || task.toDate ? (
                      <Typography.Text type="secondary">
                        {task.fromDate ?? "最早消息"} 至{" "}
                        {task.toDate ?? "最新消息"}
                      </Typography.Text>
                    ) : null}
                  </div>
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
                width: 100,
                render: (status: string) => (
                  <Tag
                    color={
                      status === "COMPLETED"
                        ? "success"
                        : status === "FAILED"
                          ? "error"
                          : ["PAUSED", "CANCELLED"].includes(status)
                            ? "default"
                            : "processing"
                    }
                  >
                    {collectionStatusLabel(status)}
                  </Tag>
                ),
              },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 165,
                render: (value: string) =>
                  dayjs(value).format("YYYY-MM-DD HH:mm"),
              },
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
                          ? ` · 最近检查 ${dayjs(task.liveCheckedAt).format("MM-DD HH:mm")}`
                          : ""}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              },
              {
                title: "操作",
                width: 240,
                render: (_, task) => (
                  <Space size={4}>
                    <Button
                      type="link"
                      onClick={() => {
                        if (
                          task.messageLink &&
                          (task.maxMessages === 1 || task.includeAlbum) &&
                          can("telegram:download")
                        ) {
                          mediaPreviewGeneration.current += 1;
                          setInlineMediaPreview({
                            taskId: task.id,
                            messageLink: task.messageLink,
                          });
                          return;
                        }
                        setCollectionPage(1);
                        setSelectedCollection(task);
                      }}
                    >
                      {task.messageLink &&
                      (task.maxMessages === 1 || task.includeAlbum) &&
                      can("telegram:download")
                        ? "预览媒体"
                        : "查看消息"}
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
                    (!["COMPLETED", "FAILED", "CANCELLED"].includes(
                      task.status,
                    ) ||
                      (task.status !== "CANCELLED" &&
                        task.pendingMediaCount > 0)) ? (
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
                        {["COMPLETED", "FAILED"].includes(task.status)
                          ? "停止附件下载"
                          : "取消"}
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
                                <TelegramAttachmentDownload
                                  attachment={attachment}
                                />
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

      {workspaceTab === "account" &&
        view?.connected &&
        can("telegram:view") && (
          <Collapse
            className="telegram-account-diagnostics"
            items={[
              {
                key: "unmatched",
                label: "未匹配的机器人消息",
                children: (
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
                ),
              },
            ]}
          />
        )}

      {inlineMediaPreview ? (
        <TelegramMessageMediaPreview
          key={inlineMediaPreview.taskId}
          onRetry={() =>
            createInlineMediaPreview.mutate(inlineMediaPreview.messageLink)
          }
          retrying={createInlineMediaPreview.isPending}
          taskId={inlineMediaPreview.taskId}
          messageLink={inlineMediaPreview.messageLink}
          onClose={() => {
            mediaPreviewGeneration.current += 1;
            message.destroy("telegram-media-preview");
            setInlineMediaPreview(null);
          }}
        />
      ) : null}
    </Space>
  );
}
