import { useDeferredValue, useState } from "react";
import {
  App,
  Alert,
  Button,
  ColorPicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
} from "antd";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "../components/DataTable";
import { FormModal } from "../components/FormModal";
import { QueryState, RefreshButton, StatusTag } from "../components/shared";
import { api, jsonBody, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import { channelHref, type PortalChannel } from "../lib/portal";
import { SiteSettingsPage } from "./SiteSettingsPage";
import type { ContentRecord } from "../types/content";
import type { Entry, PageResult } from "../types";
import "../portal-management.css";

const templateLabels = {
  GUIDE: "指南页",
  NOTICE: "公告页",
  UPDATE: "更新时间轴",
  STORY: "图文杂志",
};
interface ChannelDraft extends Omit<PortalChannel, "id" | "categories"> {
  categoryIds: number[];
}
interface CategoryOption {
  id: number;
  name: string;
  enabled: boolean;
  channelId: number | null;
}
interface HomeConfig {
  version: number;
  heroArticleId: number | null;
  noticeArticleId: number | null;
  featuredArticleIds: number[];
  allowThemeToggle: boolean;
  nightPrimaryColor: string;
}

/** 编排摘要显示已发布标题，查询仍受内容查看范围约束；停用或无权查看时保留配置而不泄露正文。 */
function HomeArticleName({
  id,
  fallback,
}: {
  id?: number | null;
  fallback: string;
}) {
  const { can } = useAuth();
  const selected = useQuery({
    queryKey: ["portal", "article-option", id],
    queryFn: ({ signal }) =>
      api<ContentRecord>(`/content/notices/${id}`, { signal }),
    enabled: !!id && can("notices:view"),
    retry: false,
  });
  if (!id) return fallback;
  if (selected.isLoading && can("notices:view")) return "正在加载文章名称";
  return selected.data?.liveTitle ?? "已配置文章（当前不可查看）";
}

/** 选择公开内容仍通过管理接口的数据范围过滤；实际保存再次检查，不能靠匿名列表越过作者权限。 */
function HomeArticleSelect({
  value,
  onChange,
  noticeOnly = false,
  noticeChannelIds = [],
}: {
  value?: number | null;
  onChange?: (value: number | null) => void;
  noticeOnly?: boolean;
  noticeChannelIds?: number[];
}) {
  const [search, setSearch] = useState("");
  const keyword = useDeferredValue(search);
  const options = useQuery({
    queryKey: ["portal", "article-options", keyword, noticeOnly],
    queryFn: ({ signal }) =>
      api<PageResult<ContentRecord>>(
        `/content/notices?${queryString({ keyword, publiclyVisible: true, portalTemplate: noticeOnly ? "NOTICE" : undefined, size: 100 })}`,
        { signal },
      ),
  });
  const selected = useQuery({
    queryKey: ["portal", "article-option", value],
    queryFn: ({ signal }) =>
      api<ContentRecord>(`/content/notices/${value}`, { signal }),
    enabled: !!value,
    retry: false,
  });
  const records = [
    ...(options.data?.items ?? []),
    ...(selected.data ? [selected.data] : []),
  ];
  const unique = [
    ...new Map(records.map((row) => [row.id, row])).values(),
  ].filter(
    (row) =>
      row.publiclyVisible &&
      (!noticeOnly || noticeChannelIds.includes(row.livePortalChannelId ?? 0)),
  );
  const items = unique.map((row) => ({
    value: row.id,
    label: row.liveTitle ?? row.title,
  }));
  if (value && !items.some((item) => item.value === value))
    items.push({ value, label: `内容 #${value}（当前不可选择，可清除）` });
  return (
    <Select
      aria-label={noticeOnly ? "选择公告条内容" : "选择公开内容"}
      value={value ?? undefined}
      onChange={(id) => onChange?.(id ?? null)}
      allowClear
      showSearch={{ filterOption: false, onSearch: setSearch }}
      placeholder="搜索已公开内容标题"
      loading={options.isFetching}
      options={items}
      notFoundContent={
        options.isError
          ? "内容无法加载，请重新输入搜索"
          : "没有可选择的公开内容"
      }
    />
  );
}

/** 门户栏目、首页编排和主题策略各自授权；编辑冻结原版本，列表刷新不会覆盖正在编辑的配置。 */
export function PortalStructurePage() {
  const { can } = useAuth();
  const { message, modal } = App.useApp();
  const client = useQueryClient();
  const channels = useQuery({
    queryKey: ["portal", "channels"],
    queryFn: ({ signal }) =>
      api<PortalChannel[]>("/portal-management/channels", { signal }),
  });
  const categoryOptions = useQuery({
    queryKey: ["portal", "category-options"],
    queryFn: ({ signal }) =>
      api<CategoryOption[]>("/portal-management/category-options", { signal }),
  });
  const home = useQuery({
    queryKey: ["portal", "home-config"],
    queryFn: ({ signal }) =>
      api<HomeConfig>("/portal-management/home", { signal }),
  });
  const [editing, setEditing] = useState<PortalChannel | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<ChannelDraft>();
  const [homeOpen, setHomeOpen] = useState(false);
  const [homeOriginal, setHomeOriginal] = useState<HomeConfig | null>(null);
  const [homeForm] = Form.useForm<HomeConfig>();
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyForm] =
    Form.useForm<
      Pick<HomeConfig, "version" | "allowThemeToggle" | "nightPrimaryColor">
    >();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryForm] = Form.useForm<{ name: string; code: string }>();
  const [tab, setTab] = useState("channels");
  const ids = Form.useWatch("categoryIds", form) ?? [];
  const featured = Form.useWatch("featuredArticleIds", homeForm) ?? [];
  const refresh = () => void client.invalidateQueries();
  const edit = (row: PortalChannel | null) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue(
      row
        ? { ...row, categoryIds: row.categories.map((category) => category.id) }
        : {
            code: "",
            name: "",
            template: "GUIDE",
            description: "",
            enabled: true,
            sortOrder: 50,
            categoryIds: [],
          },
    );
    setOpen(true);
  };
  const moveCategory = (index: number, direction: number) => {
    const next = [...ids];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    form.setFieldValue("categoryIds", next);
  };
  const openHome = () => {
    if (!home.data) return;
    setHomeOriginal({
      ...home.data,
      featuredArticleIds: [...home.data.featuredArticleIds],
    });
    homeForm.setFieldsValue(home.data);
    setHomeOpen(true);
  };
  const categoryNames = new Map(
    (categoryOptions.data ?? []).map((category) => [
      category.id,
      category.name,
    ]),
  );
  const homeContent = (
    <section className="panel module-panel">
      <div className="module-toolbar">
        <Space>
          <RefreshButton
            onClick={() => void home.refetch()}
            loading={home.isFetching}
          />
          {can("portal:update") && can("notices:view") && (
            <Button type="primary" onClick={openHome}>
              编辑首页编排
            </Button>
          )}
        </Space>
        <a href="/" target="_blank" rel="noreferrer">
          查看前台
        </a>
      </div>
      <QueryState
        loading={home.isLoading}
        error={home.error}
        retry={() => void home.refetch()}
      >
        <Descriptions
          bordered
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: "hero",
              label: "主视觉",
              children: (
                <HomeArticleName
                  id={home.data?.heroArticleId}
                  fallback="自动选择公开指南"
                />
              ),
            },
            {
              key: "notice",
              label: "公告条",
              children: (
                <HomeArticleName
                  id={home.data?.noticeArticleId}
                  fallback="自动选择最近公告"
                />
              ),
            },
            {
              key: "featured",
              label: "精选内容",
              children: home.data?.featuredArticleIds.length
                ? `${home.data.featuredArticleIds.length} 篇，按配置顺序展示`
                : "自动选择最近公开内容",
            },
            {
              key: "visibility",
              label: "显示规则",
              children: "文章下线、分类或栏目停用后同步隐藏",
            },
          ]}
        />
      </QueryState>
    </section>
  );
  const themeContent = (
    <>
      <section className="panel module-panel">
        <div className="module-toolbar">
          <b>访客主题策略</b>
          {can("portal:update") && (
            <Button
              disabled={!home.data}
              onClick={() => {
                policyForm.setFieldsValue(home.data ?? {});
                setPolicyOpen(true);
              }}
            >
              配置明暗切换
            </Button>
          )}
        </div>
        <Descriptions
          bordered
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: "toggle",
              label: "访客切换",
              children: home.data?.allowThemeToggle
                ? "允许，仅在访客当前浏览器生效"
                : "关闭，使用网站统一主题",
            },
            {
              key: "accent",
              label: "暗夜强调色",
              children: home.data?.nightPrimaryColor ?? "—",
            },
          ]}
        />
      </section>
      {can("settings:view") ? (
        <SiteSettingsPage themeOnly />
      ) : (
        <Alert type="info" title="网站默认主题需要网站配置查看权限。" />
      )}
    </>
  );
  return (
    <>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "channels",
            label: "栏目配置",
            children: (
              <QueryState
                loading={channels.isLoading}
                error={channels.error}
                retry={() => void channels.refetch()}
              >
                <section className="panel module-panel">
                  <div className="module-toolbar">
                    <Space>
                      <RefreshButton
                        onClick={refresh}
                        loading={channels.isFetching}
                      />
                      {can("portal:create") && (
                        <Button
                          type="primary"
                          icon={<Plus size={16} />}
                          onClick={() => edit(null)}
                        >
                          新增栏目
                        </Button>
                      )}
                    </Space>
                  </div>
                  <DataTable<PortalChannel>
                    rowKey="id"
                    dataSource={channels.data ?? []}
                    pagination={{ defaultPageSize: 8, showSizeChanger: false }}
                    columns={[
                      { title: "栏目名称", dataIndex: "name", width: 180 },
                      {
                        title: "页面模板",
                        dataIndex: "template",
                        width: 160,
                        render: (template: keyof typeof templateLabels) =>
                          templateLabels[template],
                      },
                      {
                        title: "访问名称",
                        dataIndex: "code",
                        width: 140,
                        ellipsis: true,
                      },
                      {
                        title: "栏目内分类",
                        width: 250,
                        render: (_, row) =>
                          row.categories
                            .map((category) => category.name)
                            .join("、") || "未关联分类",
                        ellipsis: true,
                      },
                      { title: "排序", dataIndex: "sortOrder", width: 80 },
                      {
                        title: "状态",
                        dataIndex: "enabled",
                        width: 100,
                        render: (enabled) => <StatusTag enabled={enabled} />,
                      },
                      {
                        title: "操作",
                        key: "actions",
                        width: 160,
                        render: (_, row) => (
                          <Space>
                            <a
                              href={channelHref(row.code)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              预览
                            </a>
                            {can("portal:update") && (
                              <Button
                                type="text"
                                aria-label={`编辑${row.name}`}
                                title="编辑"
                                icon={<Pencil size={16} />}
                                onClick={() => edit(row)}
                              />
                            )}{" "}
                            {can("portal:delete") && (
                              <Button
                                type="text"
                                danger
                                aria-label={`删除${row.name}`}
                                title="删除"
                                icon={<Trash2 size={16} />}
                                onClick={() =>
                                  modal.confirm({
                                    title: "删除栏目",
                                    content:
                                      "仅能删除没有分类和历史内容引用的栏目；有内容时请停用。",
                                    okText: "删除",
                                    cancelText: "取消",
                                    onOk: async () => {
                                      await api(
                                        `/portal-management/channels/${row.id}?version=${row.version}`,
                                        { method: "DELETE" },
                                      );
                                      message.success("栏目已删除");
                                      refresh();
                                    },
                                  })
                                }
                              />
                            )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                </section>
              </QueryState>
            ),
          },
          { key: "home", label: "首页编排", children: homeContent },
          { key: "theme", label: "前台主题", children: themeContent },
        ]}
      />
      <FormModal
        title={editing ? "编辑栏目" : "新增栏目"}
        open={open}
        form={form}
        width={720}
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          await api(
            `/portal-management/channels${editing ? "/" + editing.id : ""}`,
            {
              method: editing ? "PUT" : "POST",
              body: jsonBody({
                ...values,
                categoryIds: values.categoryIds ?? [],
                version: editing?.version ?? null,
              }),
            },
          );
          setOpen(false);
          message.success("栏目配置已保存");
          refresh();
        }}
      >
        <div className="form-two-columns">
          <Form.Item
            name="name"
            label="栏目名称"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item
            name="template"
            label="页面模板"
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(templateLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
        </div>
        <Form.Item
          name="code"
          label="访问名称"
          extra="创建后固定，用于保持文章入口和客户书签。"
          rules={[
            { required: true },
            {
              pattern: /^[a-z][a-z0-9-]{0,47}$/,
              message: "使用小写字母开头的字母、数字或短横线",
            },
          ]}
        >
          <Input disabled={!!editing} maxLength={48} />
        </Form.Item>
        <Form.Item name="description" label="栏目说明">
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
        <div className="form-two-columns">
          <Form.Item
            name="sortOrder"
            label="导航顺序"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={9999} />
          </Form.Item>
          <Form.Item name="enabled" label="启用栏目" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
        <Form.Item
          name="categoryIds"
          label="栏目内分类"
          extra="分类只在本栏目筛选；历史内容已引用的分类不能移出，可在内容分类中停用。"
        >
          <Select
            mode="multiple"
            placeholder="关联已有分类"
            loading={categoryOptions.isLoading}
            options={(categoryOptions.data ?? []).map((category) => ({
              value: category.id,
              label: category.name + (category.enabled ? "" : "（停用）"),
              disabled:
                category.channelId !== null &&
                category.channelId !== editing?.id,
            }))}
          />
        </Form.Item>
        {!!ids.length && (
          <div className="portal-category-order">
            {ids.map((id: number, index: number) => (
              <div key={id}>
                <span>{categoryNames.get(id) ?? `分类 #${id}`}</span>
                <Space>
                  <Button
                    type="text"
                    aria-label={`上移${categoryNames.get(id)}`}
                    disabled={index === 0}
                    icon={<ArrowUp size={15} />}
                    onClick={() => moveCategory(index, -1)}
                  />
                  <Button
                    type="text"
                    aria-label={`下移${categoryNames.get(id)}`}
                    disabled={index === ids.length - 1}
                    icon={<ArrowDown size={15} />}
                    onClick={() => moveCategory(index, 1)}
                  />
                </Space>
              </div>
            ))}
          </div>
        )}
        {can("categories:create") && (
          <Button
            icon={<Plus size={15} />}
            onClick={() => {
              categoryForm.resetFields();
              setCategoryOpen(true);
            }}
          >
            新建分类
          </Button>
        )}
      </FormModal>
      <FormModal
        title="新建内容分类"
        open={categoryOpen}
        form={categoryForm}
        zIndex={1100}
        onCancel={() => setCategoryOpen(false)}
        onSubmit={async (values) => {
          const category = await api<Entry>("/system/entries/categories", {
            method: "POST",
            body: jsonBody({ ...values, enabled: true, sortOrder: 0 }),
          });
          await client.invalidateQueries({
            queryKey: ["portal", "category-options"],
          });
          form.setFieldValue("categoryIds", [...ids, category.id]);
          setCategoryOpen(false);
          message.success("分类已建立；保存栏目后关联生效");
        }}
      >
        <Form.Item
          name="name"
          label="分类名称"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input maxLength={32} />
        </Form.Item>
        <Form.Item
          name="code"
          label="分类编码"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input maxLength={100} />
        </Form.Item>
      </FormModal>
      <FormModal
        title="首页编排"
        open={homeOpen}
        form={homeForm}
        width={740}
        onCancel={() => setHomeOpen(false)}
        onSubmit={async (values) => {
          await api("/portal-management/home", {
            method: "PUT",
            body: jsonBody({
              ...values,
              version: homeOriginal?.version,
              heroArticleId: values.heroArticleId ?? null,
              noticeArticleId: values.noticeArticleId ?? null,
              featuredArticleIds: values.featuredArticleIds ?? [],
              allowThemeToggle: homeOriginal?.allowThemeToggle,
              nightPrimaryColor: homeOriginal?.nightPrimaryColor,
            }),
          });
          setHomeOpen(false);
          message.success("首页配置已保存");
          refresh();
        }}
      >
        <Form.Item
          name="heroArticleId"
          label="首页主视觉文章"
          extra="留空自动选择公开指南；指定文章下线后隐藏，不发布草稿。"
        >
          <HomeArticleSelect />
        </Form.Item>
        <Form.Item
          name="noticeArticleId"
          label="首页公告条"
          extra="仅可选择已公开公告；留空自动选择最近公告。"
        >
          <HomeArticleSelect
            noticeOnly
            noticeChannelIds={(channels.data ?? [])
              .filter((channel) => channel.template === "NOTICE")
              .map((channel) => channel.id)}
          />
        </Form.Item>
        <Form.List name="featuredArticleIds">
          {(fields, { add, remove, move }) => (
            <>
              <label className="portal-order-label">
                精选内容（按顺序展示，最多 12 篇）
              </label>
              {fields.map((field, index) => (
                <div className="portal-feature-order" key={field.key}>
                  <Form.Item
                    name={field.name}
                    rules={[{ required: true, message: "请选择公开内容" }]}
                  >
                    <HomeArticleSelect />
                  </Form.Item>
                  <Button
                    type="text"
                    aria-label={`上移第${index + 1}篇精选`}
                    disabled={index === 0}
                    icon={<ArrowUp size={15} />}
                    onClick={() => move(index, index - 1)}
                  />
                  <Button
                    type="text"
                    aria-label={`下移第${index + 1}篇精选`}
                    disabled={index === fields.length - 1}
                    icon={<ArrowDown size={15} />}
                    onClick={() => move(index, index + 1)}
                  />
                  <Button
                    type="text"
                    danger
                    aria-label={`移除第${index + 1}篇精选`}
                    icon={<Trash2 size={15} />}
                    onClick={() => remove(index)}
                  />
                </div>
              ))}
              <Button
                icon={<Plus size={15} />}
                disabled={featured.length >= 12}
                onClick={() => add(undefined)}
              >
                添加精选内容
              </Button>
            </>
          )}
        </Form.List>
      </FormModal>
      <FormModal
        title="访客主题策略"
        open={policyOpen}
        form={policyForm}
        onCancel={() => setPolicyOpen(false)}
        onSubmit={async (values) => {
          await api("/portal-management/theme-policy", {
            method: "PUT",
            body: jsonBody(values),
          });
          setPolicyOpen(false);
          message.success("访客主题策略已保存");
          refresh();
        }}
      >
        <Form.Item name="version" hidden>
          <InputNumber />
        </Form.Item>
        <div className="form-two-columns portal-theme-policy">
          <Form.Item
            name="allowThemeToggle"
            label="允许访客切换明暗"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="nightPrimaryColor"
            label="暗夜强调色"
            rules={[
              { required: true },
              { pattern: /^#[0-9a-fA-F]{6}$/, message: "请选择六位颜色值" },
            ]}
            getValueFromEvent={(color) => color.toHexString()}
          >
            <ColorPicker disabledAlpha />
          </Form.Item>
        </div>
      </FormModal>
    </>
  );
}
