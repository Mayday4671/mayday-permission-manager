import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Avatar,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Select,
  Spin,
  Tag,
} from "antd";
import {
  ArrowLeftOutlined,
  FileOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SoundOutlined,
} from "@ant-design/icons";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { api, jsonBody } from "../../lib/api";
import { useAuth } from "../../lib/auth";

interface Channel {
  chatId: string;
  title: string;
  username: string | null;
}
interface ChannelPage {
  items: Channel[];
  nextCursor: string | null;
}
interface ChannelMessage {
  id: string;
  text: string | null;
  contentType: string;
  canBeSaved: boolean;
  sentAt: number | null;
  hasMedia: boolean;
}
interface MessagePage {
  items: ChannelMessage[];
  nextCursor: string | null;
}
interface CollectionValues {
  maxMessages: number;
  dates?: [Dayjs, Dayjs];
  attachments?: string[];
}

/** Browses joined channels without creating tasks until a user explicitly collects or previews a post. */
export function TelegramChannelBrowser({
  connected,
  onPreview,
  onConnection,
  onRecords,
}: {
  connected: boolean;
  onPreview: (link: string) => void;
  onConnection: () => void;
  onRecords: () => void;
}) {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Channel | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [collectionMode, setCollectionMode] = useState<"channel" | "selection">(
    "channel",
  );
  const [keyword, setKeyword] = useState("");
  const [mediaType, setMediaType] = useState("ALL");
  const [dates, setDates] = useState<[Dayjs, Dayjs] | null>(null);
  const [filters, setFilters] = useState({
    query: "",
    type: "ALL",
    from: "",
    to: "",
  });
  const [checked, setChecked] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchError, setBatchError] = useState("");
  const filtering =
    !!filters.query || filters.type !== "ALL" || !!filters.from || !!filters.to;
  const [form] = Form.useForm<CollectionValues>();
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const channels = useInfiniteQuery({
    queryKey: ["telegram", "joined-channels"],
    initialPageParam: "0:0",
    queryFn: ({ pageParam }) =>
      api<ChannelPage>(
        `/telegram/channels?cursor=${encodeURIComponent(pageParam)}`,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: connected && !query,
    retry: false,
  });
  const results = useQuery({
    queryKey: ["telegram", "joined-channel-search", query],
    queryFn: () =>
      api<Channel[]>(
        `/telegram/collections/channels?query=${encodeURIComponent(query)}&size=50`,
      ),
    enabled: connected && !!query,
    retry: false,
  });
  const directory = query
    ? (results.data ?? [])
    : Array.from(
        new Map(
          (channels.data?.pages.flatMap((page) => page.items) ?? []).map(
            (channel) => [channel.chatId, channel],
          ),
        ).values(),
      );
  const listError = query ? results.error : channels.error;
  const listLoading = query ? results.isFetching : channels.isFetching;
  const historyKey = ["telegram", "channel-history", selected?.chatId, filters];
  const history = useInfiniteQuery({
    queryKey: historyKey,
    initialPageParam: "0",
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        filtering
          ? `/telegram/channels/${selected!.chatId}/search?${new URLSearchParams(Object.entries({ ...filters, cursor: pageParam }).filter(([, value]) => value !== ""))}`
          : `/telegram/channels/${selected!.chatId}/messages?before=${pageParam}`,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: connected && !!selected,
    retry: false,
  });
  const posts = Array.from(
    new Map(
      (history.data?.pages.flatMap((page) => page.items) ?? []).map((post) => [
        post.id,
        post,
      ]),
    ).values(),
  ).sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0,
  );
  useEffect(() => {
    if (history.data?.pages.length === 1 && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [selected?.chatId, history.data]);
  const postAction = useMutation({
    mutationFn: async ({
      chatId,
      post,
      preview,
    }: {
      chatId: string;
      post: ChannelMessage;
      preview: boolean;
    }) => {
      const link = await api<string>(
        `/telegram/channels/${chatId}/messages/${post.id}/link`,
      );
      if (preview) return { link, preview };
      await api("/telegram/collections", {
        method: "POST",
        body: jsonBody({
          messageLink: link,
          maxMessages: 10,
          includeAlbum: true,
          downloadImages: can("telegram:download"),
          downloadVideos: can("telegram:download"),
          downloadDocuments: can("telegram:download"),
        }),
      });
      return { link, preview };
    },
    onSuccess: ({ link, preview }) => {
      if (preview) onPreview(link);
      else {
        void client.invalidateQueries({
          queryKey: ["telegram", "collections"],
        });
        message.success("已创建消息采集任务");
      }
    },
    onError: (error: Error) => message.error(error.message),
  });
  const collect = useMutation({
    mutationFn: (values: CollectionValues) =>
      api("/telegram/collections", {
        method: "POST",
        body: jsonBody({
          channelId: selected!.chatId,
          maxMessages: values.maxMessages,
          ...(values.dates
            ? {
                fromDate: values.dates[0].format("YYYY-MM-DD"),
                toDate: values.dates[1].format("YYYY-MM-DD"),
              }
            : {}),
          downloadImages:
            can("telegram:download") &&
            !!values.attachments?.includes("images"),
          downloadVideos:
            can("telegram:download") &&
            !!values.attachments?.includes("videos"),
          downloadDocuments:
            can("telegram:download") &&
            !!values.attachments?.includes("documents"),
        }),
      }),
    onSuccess: () => {
      setCollecting(false);
      form.resetFields();
      void client.invalidateQueries({ queryKey: ["telegram", "collections"] });
      message.success("频道采集已创建，可在采集记录中查看进度");
    },
    onError: (error: Error) => message.error(error.message),
  });
  const batchCollect = useMutation({
    mutationFn: async (values: CollectionValues) => {
      const failed: string[] = [];
      let failure = "";
      setBatchProgress(0);
      setBatchError("");
      const chatId = selected!.chatId;
      const ids = [...checked];
      for (const [index, id] of ids.entries()) {
        try {
          const link = await api<string>(
            `/telegram/channels/${chatId}/messages/${id}/link`,
          );
          await api("/telegram/collections", {
            method: "POST",
            body: jsonBody({
              messageLink: link,
              // Batch selection is exact; selecting two album members must not collect the whole album twice.
              includeAlbum: false,
              maxMessages: 1,
              downloadImages:
                can("telegram:download") &&
                !!values.attachments?.includes("images"),
              downloadVideos:
                can("telegram:download") &&
                !!values.attachments?.includes("videos"),
              downloadDocuments:
                can("telegram:download") &&
                !!values.attachments?.includes("documents"),
            }),
          });
        } catch (error) {
          failed.push(id);
          failure = error instanceof Error ? error.message : "采集失败";
        }
        setBatchProgress(index + 1);
      }
      return { failed, failure, total: ids.length };
    },
    onSuccess: ({ failed, failure, total }) => {
      setChecked(failed);
      setCollecting(false);
      setBatchError(
        failed.length
          ? `${failed.length} 条创建失败，已保留勾选，可重试。${failure}`
          : "",
      );
      void client.invalidateQueries({ queryKey: ["telegram", "collections"] });
      message.info(
        `已创建 ${total - failed.length} 条采集任务${failed.length ? `，${failed.length} 条失败` : ""}`,
      );
    },
  });
  const applyFilters = () => {
    setChecked([]);
    setBatchError("");
    setFilters({
      query: keyword.trim(),
      type: mediaType,
      from: dates ? String(dates[0].startOf("day").unix()) : "",
      to: dates ? String(dates[1].endOf("day").unix()) : "",
    });
  };
  const openCollection = (mode: "channel" | "selection") => {
    setCollectionMode(mode);
    form.setFieldsValue({
      maxMessages: 100,
      dates: dates ?? undefined,
      attachments: [],
    });
    setCollecting(true);
  };
  const refreshDirectory = () =>
    query
      ? void results.refetch()
      : void client.resetQueries({ queryKey: ["telegram", "joined-channels"] });
  if (!connected)
    return (
      <Empty description="连接 Telegram 后查看已加入频道">
        <Button type="primary" onClick={onConnection}>
          前往连接
        </Button>
      </Empty>
    );
  return (
    <>
      <section
        className={`telegram-channel-browser${selected ? " has-selection" : ""}`}
        aria-label="频道浏览"
      >
        <aside className="telegram-channel-directory">
          <div className="telegram-channel-search">
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索已加入频道"
              aria-label="搜索已加入频道"
              value={search}
              maxLength={100}
              allowClear
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              aria-label="刷新频道列表"
              icon={<ReloadOutlined />}
              onClick={refreshDirectory}
              loading={listLoading}
            />
          </div>
          <div className="telegram-channel-list">
            {listError ? (
              <Alert
                type="error"
                title={listError.message}
                action={<Button onClick={refreshDirectory}>重试</Button>}
              />
            ) : null}
            {!directory.length && listLoading ? <Spin /> : null}
            {!directory.length && !listLoading && !listError ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  query
                    ? "没有匹配的已加入频道"
                    : channels.hasNextPage
                      ? "本批没有频道，继续加载"
                      : "暂无已加入频道"
                }
              />
            ) : null}
            {directory.map((channel) => (
              <button
                type="button"
                key={channel.chatId}
                className={`telegram-channel-item${selected?.chatId === channel.chatId ? " is-selected" : ""}`}
                aria-pressed={selected?.chatId === channel.chatId}
                disabled={batchCollect.isPending}
                onClick={() => {
                  setSelected(channel);
                  setChecked([]);
                  setBatchError("");
                }}
              >
                <Avatar size={42}>
                  {Array.from(channel.title)[0] || <SoundOutlined />}
                </Avatar>
                <span>
                  <strong>{channel.title}</strong>
                  <small>
                    {channel.username ? `@${channel.username}` : "私密频道"}
                  </small>
                </span>
              </button>
            ))}
            {!query && channels.hasNextPage ? (
              <Button
                block
                type="text"
                loading={channels.isFetchingNextPage}
                onClick={() => void channels.fetchNextPage()}
              >
                加载更多频道
              </Button>
            ) : null}
          </div>
          <Button
            className="telegram-channel-records"
            type="text"
            onClick={onRecords}
          >
            查看采集记录
          </Button>
        </aside>
        <div className="telegram-channel-conversation">
          {selected ? (
            <>
              <header className="telegram-channel-header">
                <Button
                  className="telegram-channel-back"
                  aria-label="返回频道列表"
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setSelected(null)}
                />
                <div>
                  <strong>{selected.title}</strong>
                  <small>
                    {selected.username ? `@${selected.username}` : "私密频道"}
                  </small>
                </div>
                <Space>
                  <Button
                    aria-label="刷新频道消息"
                    icon={<ReloadOutlined />}
                    onClick={() =>
                      void client.resetQueries({ queryKey: historyKey })
                    }
                    loading={history.isFetching}
                  />
                  <Button
                    type="primary"
                    disabled={batchCollect.isPending}
                    onClick={() => openCollection("channel")}
                  >
                    按日期采集
                  </Button>
                </Space>
              </header>
              <div className="telegram-channel-tools">
                <div className="telegram-channel-filter-row">
                  <Input
                    aria-label="频道消息关键词"
                    placeholder="查找频道消息"
                    value={keyword}
                    maxLength={200}
                    disabled={batchCollect.isPending}
                    onChange={(e) => setKeyword(e.target.value)}
                    onPressEnter={applyFilters}
                    allowClear
                  />
                  <Select
                    aria-label="频道消息类型"
                    value={mediaType}
                    disabled={batchCollect.isPending}
                    onChange={setMediaType}
                    options={[
                      { value: "ALL", label: "全部类型" },
                      { value: "PHOTO", label: "图片" },
                      { value: "VIDEO", label: "视频" },
                      { value: "DOCUMENT", label: "文件" },
                      { value: "AUDIO", label: "音频" },
                      { value: "LINK", label: "链接" },
                    ]}
                  />
                  <DatePicker.RangePicker
                    aria-label="频道消息日期"
                    value={dates}
                    disabled={batchCollect.isPending}
                    onChange={(value) =>
                      setDates(
                        value?.[0] && value?.[1] ? [value[0], value[1]] : null,
                      )
                    }
                  />
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    disabled={batchCollect.isPending}
                    onClick={applyFilters}
                  >
                    查找
                  </Button>
                  <Button
                    disabled={batchCollect.isPending}
                    onClick={() => {
                      setKeyword("");
                      setMediaType("ALL");
                      setDates(null);
                      setChecked([]);
                      setFilters({ query: "", type: "ALL", from: "", to: "" });
                    }}
                  >
                    重置
                  </Button>
                </div>
                <div className="telegram-channel-selection-row">
                  <Checkbox
                    disabled={
                      batchCollect.isPending || !posts.some((p) => p.canBeSaved)
                    }
                    checked={
                      checked.length > 0 &&
                      posts
                        .filter((p) => p.canBeSaved)
                        .every((p) => checked.includes(p.id))
                    }
                    indeterminate={
                      checked.length > 0 &&
                      posts.some((p) => p.canBeSaved && !checked.includes(p.id))
                    }
                    onChange={(e) =>
                      setChecked(
                        e.target.checked
                          ? posts.filter((p) => p.canBeSaved).map((p) => p.id)
                          : [],
                      )
                    }
                  >
                    全选已加载
                  </Checkbox>
                  <span>
                    已加载 {posts.length} 条 · 已选 {checked.length} 条
                  </span>
                  <Button
                    disabled={!checked.length || batchCollect.isPending}
                    onClick={() => openCollection("selection")}
                  >
                    采集选中
                  </Button>
                </div>
                {batchError ? (
                  <Alert
                    type="error"
                    title={batchError}
                    closable
                    onClose={() => setBatchError("")}
                  />
                ) : null}
              </div>
              <div className="telegram-channel-transcript" ref={transcript}>
                {history.error ? (
                  <Alert
                    type="error"
                    title={history.error.message}
                    action={
                      <Button onClick={() => void history.refetch()}>
                        重试
                      </Button>
                    }
                  />
                ) : null}
                {history.isPending ? <Spin /> : null}
                {history.hasNextPage ? (
                  <Button
                    className="telegram-channel-older"
                    type="text"
                    loading={history.isFetchingNextPage}
                    onClick={async () => {
                      const height = transcript.current?.scrollHeight ?? 0;
                      const top = transcript.current?.scrollTop ?? 0;
                      await history.fetchNextPage();
                      requestAnimationFrame(() => {
                        if (transcript.current)
                          transcript.current.scrollTop =
                            top + transcript.current.scrollHeight - height;
                      });
                    }}
                  >
                    {filtering ? "继续查找" : "加载更早消息"}
                  </Button>
                ) : null}
                {!posts.length && !history.isPending && !history.error ? (
                  <Empty
                    description={
                      filtering
                        ? history.hasNextPage
                          ? "本批无匹配消息，可继续查找"
                          : "没有匹配的消息"
                        : "暂无可读取消息"
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : null}
                {posts.map((post) => (
                  <article key={post.id} className="telegram-channel-post">
                    <div className="telegram-channel-post-meta">
                      {post.canBeSaved ? (
                        <Checkbox
                          aria-label={`选择消息 ${post.id}`}
                          checked={checked.includes(post.id)}
                          disabled={batchCollect.isPending}
                          onChange={(e) =>
                            setChecked((ids) =>
                              e.target.checked
                                ? [...ids, post.id]
                                : ids.filter((id) => id !== post.id),
                            )
                          }
                        />
                      ) : null}
                      <SoundOutlined />
                      <strong>{selected.title}</strong>
                      <time>
                        {post.sentAt
                          ? dayjs.unix(post.sentAt).format("MM-DD HH:mm")
                          : ""}
                      </time>
                    </div>
                    {post.text ? (
                      <p>{post.text}</p>
                    ) : !post.canBeSaved ? (
                      <Tag>此消息限制保存，请在 Telegram 查看</Tag>
                    ) : !post.hasMedia ? (
                      <p>（无文本消息）</p>
                    ) : null}
                    {post.hasMedia &&
                    post.canBeSaved &&
                    can("telegram:download") ? (
                      <Button
                        className="telegram-channel-media"
                        icon={
                          post.contentType === "MessageVideo" ? (
                            <PlayCircleOutlined />
                          ) : post.contentType === "MessagePhoto" ? (
                            <PictureOutlined />
                          ) : (
                            <FileOutlined />
                          )
                        }
                        disabled={postAction.isPending}
                        onClick={() =>
                          postAction.mutate({
                            chatId: selected.chatId,
                            post,
                            preview: true,
                          })
                        }
                      >
                        {post.contentType === "MessageVideo"
                          ? "播放视频"
                          : post.contentType === "MessagePhoto"
                            ? "查看图片"
                            : "预览附件"}
                      </Button>
                    ) : null}
                    {post.canBeSaved ? (
                      <div className="telegram-channel-post-actions">
                        <Button
                          size="small"
                          type="text"
                          loading={
                            postAction.isPending &&
                            postAction.variables?.post.id === post.id
                          }
                          disabled={postAction.isPending}
                          onClick={() =>
                            postAction.mutate({
                              chatId: selected.chatId,
                              post,
                              preview: false,
                            })
                          }
                        >
                          采集这条消息
                        </Button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="telegram-channel-placeholder">
              <SoundOutlined />
              <span>选择频道查看消息</span>
            </div>
          )}
        </div>
      </section>
      <Modal
        title={
          collectionMode === "selection"
            ? `采集选中的 ${checked.length} 条消息`
            : `按日期采集 · ${selected?.title ?? "频道"}`
        }
        open={collecting}
        onCancel={() => {
          if (!batchCollect.isPending && !collect.isPending)
            setCollecting(false);
        }}
        onOk={() => form.submit()}
        okText="开始采集"
        confirmLoading={collect.isPending || batchCollect.isPending}
        closable={!batchCollect.isPending && !collect.isPending}
        cancelButtonProps={{
          disabled: batchCollect.isPending || collect.isPending,
        }}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ maxMessages: 100, attachments: [] }}
          onFinish={(values) =>
            collectionMode === "selection"
              ? batchCollect.mutate(values)
              : collect.mutate(values)
          }
        >
          {collectionMode === "channel" ? (
            <>
              <Form.Item name="dates" label="消息日期">
                <DatePicker.RangePicker
                  style={{ width: "100%" }}
                  disabledDate={(date) =>
                    date.isAfter(dayjs(), "day") ||
                    date.isBefore(dayjs().subtract(10, "year"), "day")
                  }
                />
              </Form.Item>
              <Form.Item
                name="maxMessages"
                label="采集条数上限"
                rules={[{ required: true, type: "number", min: 1, max: 500 }]}
              >
                <InputNumber min={1} max={500} style={{ width: "100%" }} />
              </Form.Item>
            </>
          ) : null}
          {batchCollect.isPending ? (
            <p>
              正在创建任务 {batchProgress} / {checked.length}
            </p>
          ) : null}
          {can("telegram:download") ? (
            <Form.Item name="attachments" label="保存附件">
              <Checkbox.Group
                options={[
                  { label: "图片", value: "images" },
                  { label: "视频", value: "videos" },
                  { label: "文件", value: "documents" },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}
