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
  const historyKey = ["telegram", "channel-history", selected?.chatId];
  const history = useInfiniteQuery({
    queryKey: historyKey,
    initialPageParam: "0",
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        `/telegram/channels/${selected!.chatId}/messages?before=${pageParam}`,
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
                onClick={() => setSelected(channel)}
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
                  <Button type="primary" onClick={() => setCollecting(true)}>
                    采集频道
                  </Button>
                </Space>
              </header>
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
                    加载更早消息
                  </Button>
                ) : null}
                {!posts.length && !history.isPending && !history.error ? (
                  <Empty
                    description="暂无可读取消息"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : null}
                {posts.map((post) => (
                  <article key={post.id} className="telegram-channel-post">
                    <div className="telegram-channel-post-meta">
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
        title={selected ? `采集 · ${selected.title}` : "采集频道"}
        open={collecting}
        onCancel={() => setCollecting(false)}
        onOk={() => form.submit()}
        okText="开始采集"
        confirmLoading={collect.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ maxMessages: 100, attachments: [] }}
          onFinish={(values) => collect.mutate(values)}
        >
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
