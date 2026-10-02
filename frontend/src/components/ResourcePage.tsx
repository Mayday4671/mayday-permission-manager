import { useEffect, useRef, useState, type Key, type ReactNode } from "react";
import {
  App,
  Button,
  Form,
  Grid,
  Input,
  Popconfirm,
  Select,
  Space,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { FormInstance } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { api, jsonBody, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { BaseRecord, PageResult } from "../types";
import { Permission, QueryState, RefreshButton } from "./shared";
import { usePageState } from "../lib/workspace";
import { FormModal } from "./FormModal";
import { useTablePreferences } from "./TablePreferences";
import { RowActions, type RowAction } from "./RowActions";
import { DataTable } from "./DataTable";
import { GroupedDataTable } from "./GroupedDataTable";
import { SavedQueries } from "./SavedQueries";
import {
  readPageSize,
  validPage,
  type FilterValue,
} from "../lib/list-preferences";
import { useBrowserPreference } from "../lib/useBrowserPreference";

export interface ResourceConfig<T extends BaseRecord<string | number>> {
  /** 可选契约客户端适配，保留通用分页、弹窗与权限行为，业务页无需重复实现列表交互。 */
  transport?: {
    save: (
      values: Record<string, unknown>,
      editing: T | null,
    ) => Promise<unknown>;
    remove: (record: T) => Promise<unknown>;
  };
  resource: string;
  endpoint: string;
  /** 只供表格的可访问名称及业务提示使用；页面名称已有面包屑/标签页，正文不重复渲染标题或介绍。 */
  title: string;
  singular: string;
  columns: ColumnsType<T>;
  fields: (record: T | null, form: FormInstance) => ReactNode;
  defaults?: Record<string, unknown>;
  width?: number;
  statusField?: string;
  statusLabels?: [string, string];
  beforeSave?: (
    values: Record<string, unknown>,
    record: T | null,
  ) => Record<string, unknown>;
  canEdit?: (record: T) => boolean;
  canDelete?: (record: T) => boolean;
  extraActions?: (record: T, refresh: () => void) => ReactNode;
  readOnly?: boolean;
  extraToolbar?: ReactNode;
  extraFilters?: ReactNode;
  /** 业务筛选与通用关键词/状态一起重置，避免查询结果仍受隐藏条件影响。 */
  onResetFilters?: () => void;
  hasExtraFilters?: boolean;
  /** 操作较多的业务统一用文字与“更多”菜单；保留 extraActions 兼容简单图标扩展。 */
  rowActions?: (record: T, refresh: () => void) => RowAction[];
  createAllowed?: boolean;
  exportRows?: (params: Record<string, unknown>) => Promise<void>;
  queryParams?: Record<string, unknown>;
  /** 任务等有持续进度的页面可轮询，浏览器隐藏时由 React Query 暂停，普通列表默认关闭。 */
  refetchInterval?: number | false;
  /** 只登记可保存的业务筛选，固定接口参数与权限信息不能从浏览器偏好恢复。 */
  savedFilters?: {
    keys: string[];
    apply: (values: Record<string, FilterValue>) => void;
  };
  deleteDescription?: string;
  /** 同页面嵌套字典项等列表时隔离筛选、分页和列偏好。 */
  stateKey?: string;
  batchActions?: {
    key: string;
    label: string;
    permission: string;
    danger?: boolean;
    run: (rows: T[]) => Promise<void>;
  }[];
  canSelect?: (row: T) => boolean;
  actionsWidth?: number;
  /** 分组列表取完整查询结果再构建层级，避免服务端分页把同一目录的子菜单拆散。 */
  groupBy?: (row: T) => string;
  onFormOpen?: () => void;
  onFormInvalid?: (field: (string | number)[]) => void;
  /** 详情查询驱动的自定义编辑页可以保留通用查询表格，不重复实现按钮与请求反馈。 */
}

/**
 * 通用 CRUD 页面：服务端分页/搜索/筛选、权限按钮、编辑弹窗、错误反馈和缓存刷新统一实现。
 * 业务模块只定义列、表单、默认值与额外规则；搜索提交后重置页码，删除最后一条时回退页码。
 */
export function ResourcePage<T extends BaseRecord<string | number>>(
  config: ResourceConfig<T>,
) {
  const { resource, endpoint, columns, title, singular } = config;
  const screens = Grid.useBreakpoint();
  const { can, refresh: refreshAuth } = useAuth();
  const { message, modal } = App.useApp();
  const client = useQueryClient();
  const stateKey = config.stateKey ? config.stateKey + "." : "";
  const [keyword, setKeyword] = usePageState(stateKey + "keyword", "");
  const [search, setSearch] = usePageState(stateKey + "search", "");
  const [status, setStatus] = usePageState<boolean | undefined>(
    stateKey + "status",
    undefined,
  );
  const [page, setPage] = usePageState(stateKey + "page", 1);
  const [size, setSize] = useBrowserPreference(
    `${endpoint}.${stateKey}table.pageSize`,
    readPageSize,
  );
  const filterKey = JSON.stringify(config.queryParams);
  const previousFilter = useRef(filterKey);
  useEffect(() => {
    if (previousFilter.current !== filterKey) {
      setPage(1);
      previousFilter.current = filterKey;
    }
  }, [filterKey]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const batchActions =
    config.batchActions?.filter((action) => can(action.permission)) ?? [];
  // 选择仅属于当前查询页，切换条件立即清空；不把批量目标存储到页签恢复数据里。
  useEffect(
    () => setSelectedKeys([]),
    [endpoint, search, status, page, size, JSON.stringify(config.queryParams)],
  );
  const [form] = Form.useForm();
  // 目录名称是分组表的树形锚点，不能因旧的列显隐偏好而消失。
  const preferences = useTablePreferences(
    columns,
    `${endpoint}.${stateKey}`,
    Boolean(config.groupBy),
  );
  const params = {
    ...config.queryParams,
    keyword: search,
    page: config.groupBy ? 1 : page,
    size: config.groupBy ? 100 : size,
    ...(config.statusField ? { [config.statusField]: status } : {}),
  };
  const query = useQuery({
    refetchInterval: config.refetchInterval ?? false,
    queryKey: [resource, endpoint, params],
    queryFn: async ({ signal }) => {
      const first = await api<PageResult<T>>(
        `${endpoint}?${queryString(params)}`,
        { signal },
      );
      if (!config.groupBy) return first;
      const items = [...first.items];
      // 后端单页上限为 100。逐页读取已授权结果，不用任意大 size 假装“完整目录”。
      for (let next = 2; items.length < first.total; next++) {
        const result = await api<PageResult<T>>(
          `${endpoint}?${queryString({ ...params, page: next })}`,
          { signal },
        );
        if (!result.items.length)
          throw new Error("菜单目录已变化，请刷新后重试");
        items.push(...result.items);
      }
      return { ...first, items };
    },
  });
  useEffect(() => {
    if (query.data && !config.groupBy && !query.isFetching) {
      const next = validPage(page, size, query.data.total);
      if (next !== page) setPage(next);
    }
  }, [query.data, query.isFetching, page, size, config.groupBy]);
  // 后台刷新或权限变化后移除已经不可操作的选择，禁止用失效的勾选继续批量处理。
  useEffect(() => {
    setSelectedKeys((previous) =>
      previous.filter((key) =>
        query.data?.items.some(
          (row) => row.id === key && (config.canSelect?.(row) ?? true),
        ),
      ),
    );
  }, [query.data, config.canSelect]);
  const refresh = () => {
    void client.invalidateQueries();
    void refreshAuth().catch(() => {});
  };
  const edit = (record: T | null) => {
    config.onFormOpen?.();
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      enabled: true,
      sortOrder: 0,
      ...config.defaults,
      ...record,
    });
    setOpen(true);
  };
  // 弹窗统一处理校验、提交锁和错误反馈，业务层只负责数据转换与成功后的刷新。
  const save = async (values: Record<string, unknown>) => {
    const data = config.beforeSave
      ? config.beforeSave(values, editing)
      : values;
    if (config.transport) await config.transport.save(data, editing);
    else
      await api(`${endpoint}${editing ? `/${editing.id}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body: jsonBody({ ...data, version: editing?.version }),
      });
    message.success(`${singular}已${editing ? "更新" : "创建"}`);
    setOpen(false);
    refresh();
  };
  const remove = async (record: T) => {
    try {
      if (config.transport) await config.transport.remove(record);
      else await api(`${endpoint}/${record.id}`, { method: "DELETE" });
      message.success("已删除");
      refresh();
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const actions: ColumnsType<T> =
    config.readOnly && !config.extraActions && !config.rowActions
      ? []
      : [
          {
            title: "操作",
            key: "actions",
            width: config.actionsWidth ?? (config.extraActions ? 136 : 100),
            // 是否确实需要固定操作列由 DataTable 的容器测量决定；窄屏避免固定列遮挡数据。
            fixed: screens.md ? "right" : undefined,
            render: (_, row) =>
              config.rowActions ? (
                <RowActions
                  label={String("title" in row ? row.title : row.id)}
                  actions={[
                    ...config.rowActions(row, refresh),
                    ...(!config.readOnly &&
                    can(`${resource}:delete`) &&
                    (config.canDelete?.(row) ?? true)
                      ? [
                          {
                            key: "delete",
                            label: "删除",
                            danger: true,
                            icon: <Trash2 size={15} />,
                            confirm: {
                              title: `确认删除这条${singular}？`,
                              description:
                                config.deleteDescription ??
                                "删除后无法恢复，请确认关联数据已调整。",
                            },
                            onClick: async () => {
                              await api(`${endpoint}/${row.id}`, {
                                method: "DELETE",
                              });
                              message.success("已删除");
                              refresh();
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              ) : (
                <Space size={4} className="row-icon-actions">
                  {!config.readOnly &&
                    can(`${resource}:update`) &&
                    (config.canEdit?.(row) ?? true) && (
                      <Tooltip title={`编辑${singular}`}>
                        <Button
                          type="text"
                          aria-label={`编辑${singular}`}
                          icon={<Pencil size={15} />}
                          onClick={() => edit(row)}
                        />
                      </Tooltip>
                    )}
                  {config.extraActions?.(row, refresh)}
                  {!config.readOnly &&
                    can(`${resource}:delete`) &&
                    (config.canDelete?.(row) ?? true) && (
                      <Popconfirm
                        title={`确认删除这条${singular}？`}
                        description={
                          config.deleteDescription ??
                          "删除后无法恢复，请确认关联数据已调整。"
                        }
                        onConfirm={() => remove(row)}
                        okText="确认删除"
                        cancelText="取消"
                      >
                        <Tooltip title="删除">
                          <Button
                            type="text"
                            danger
                            aria-label={`删除${singular}`}
                            icon={<Trash2 size={15} />}
                          />
                        </Tooltip>
                      </Popconfirm>
                    )}
                </Space>
              ),
          },
        ];
  return (
    <>
      <div className="panel resource-panel">
        <div className="table-toolbar">
          <div className="filters">
            <Input
              aria-label={`搜索${singular}`}
              placeholder={`搜索${singular}名称或关键词`}
              maxLength={200}
              prefix={<Search size={16} />}
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                if (!e.target.value) {
                  setSearch("");
                  setPage(1);
                }
              }}
              onPressEnter={() => {
                setSearch(keyword.trim());
                setPage(1);
              }}
              allowClear
            />
            {config.statusField && (
              <Select
                aria-label="状态筛选"
                placeholder="全部状态"
                value={status}
                allowClear
                onChange={(v) => {
                  setStatus(v);
                  setPage(1);
                }}
                options={[
                  { value: true, label: config.statusLabels?.[0] ?? "启用" },
                  { value: false, label: config.statusLabels?.[1] ?? "停用" },
                ]}
              />
            )}
            {config.extraFilters}
            <Button
              icon={<SlidersHorizontal size={15} />}
              onClick={() => {
                setSearch(keyword.trim());
                setPage(1);
              }}
            >
              查询
            </Button>
            {(keyword ||
              search ||
              status !== undefined ||
              config.hasExtraFilters) && (
              <Button
                type="text"
                icon={<X size={14} />}
                onClick={() => {
                  setKeyword("");
                  setSearch("");
                  setStatus(undefined);
                  config.onResetFilters?.();
                  setPage(1);
                }}
              >
                重置
              </Button>
            )}
          </div>
          <Space wrap className="table-actions">
            {!config.readOnly && config.createAllowed !== false && (
              <Permission value={`${resource}:create`}>
                <Button
                  type="primary"
                  icon={<Plus size={16} />}
                  onClick={() => edit(null)}
                >
                  新增{singular}
                </Button>
              </Permission>
            )}
            {config.extraToolbar}
            {(!config.extraFilters || config.savedFilters) && (
              <SavedQueries
                namespace={`${endpoint}.${stateKey}`}
                keyword={keyword}
                status={status}
                extra={config.queryParams ?? {}}
                allowedKeys={config.savedFilters?.keys ?? []}
                onApply={(saved) => {
                  setKeyword(saved.keyword);
                  setSearch(saved.keyword);
                  setStatus(config.statusField ? saved.status : undefined);
                  config.savedFilters?.apply(saved.extra);
                  setPage(1);
                  setSelectedKeys([]);
                }}
              />
            )}
            {config.exportRows && (
              <Permission value={`${resource}:export`}>
                <Button
                  icon={<Download size={15} />}
                  loading={exporting}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      await config.exportRows!(params);
                      message.success("导出完成");
                    } catch (e) {
                      message.error((e as Error).message);
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  导出
                </Button>
              </Permission>
            )}
            <RefreshButton
              onClick={() => void query.refetch()}
              loading={query.isFetching}
            />
            {preferences.tools}
          </Space>
        </div>
        {selectedKeys.length > 0 && (
          <div className="batch-toolbar">
            <span>已选 {selectedKeys.length} 项</span>
            {batchActions.map((action) => (
              <Button
                key={action.key}
                danger={action.danger}
                disabled={query.isFetching || Boolean(query.error)}
                onClick={() => {
                  const rows = (query.data?.items ?? []).filter(
                    (row) =>
                      selectedKeys.includes(row.id) &&
                      (config.canSelect?.(row) ?? true),
                  );
                  if (!rows.length) {
                    setSelectedKeys([]);
                    return;
                  }
                  modal.confirm({
                    title: `${action.label} ${rows.length} 项？`,
                    content: "本次操作只影响当前勾选记录。",
                    centered: true,
                    okText: action.label,
                    cancelText: "取消",
                    okButtonProps: { danger: action.danger },
                    onOk: async () => {
                      try {
                        await action.run(rows);
                        message.success("批量操作完成");
                        setSelectedKeys([]);
                        refresh();
                      } catch (error) {
                        message.error((error as Error).message);
                        throw error;
                      }
                    },
                  });
                }}
              >
                {action.label}
              </Button>
            ))}
            <Button type="link" onClick={() => setSelectedKeys([])}>
              取消选择
            </Button>
          </div>
        )}
        <QueryState
          loading={false}
          error={query.error}
          retry={() => void query.refetch()}
        >
          {config.groupBy ? (
            <GroupedDataTable<T>
              rows={query.data?.items ?? []}
              columns={[...preferences.columns, ...actions]}
              groupBy={config.groupBy}
              size={preferences.density}
              loading={query.isLoading || query.isFetching}
            />
          ) : (
            <DataTable<T>
              aria-label={title}
              rowKey="id"
              columns={[...preferences.columns, ...actions]}
              size={preferences.density}
              dataSource={query.data?.items ?? []}
              rowSelection={
                batchActions.length
                  ? {
                      selectedRowKeys: selectedKeys,
                      onChange: setSelectedKeys,
                      getCheckboxProps: (row) => ({
                        disabled: config.canSelect
                          ? !config.canSelect(row)
                          : false,
                      }),
                    }
                  : undefined
              }
              loading={query.isLoading || query.isFetching}
              pagination={{
                current: page,
                pageSize: size,
                total: query.data?.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条记录`,
                onChange: (p, s) => {
                  setPage(s !== size ? 1 : p);
                  setSize(s);
                },
                pageSizeOptions: [10, 20, 50],
              }}
            />
          )}
        </QueryState>
      </div>
      <FormModal
        title={`${editing ? "编辑" : "新增"}${singular}`}
        open={open}
        form={form}
        width={config.width}
        onCancel={() => setOpen(false)}
        onSubmit={save}
        onInvalid={config.onFormInvalid}
      >
        {config.fields(editing, form)}
      </FormModal>
    </>
  );
}
