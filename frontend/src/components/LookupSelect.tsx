import { useEffect, useState } from "react";
import { Button, Empty, Select, Spin, type SelectProps } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api, queryString } from "../lib/api";
import type { Lookups, PageResult } from "../types";

export interface LookupOption {
  value: number | string;
  label: string;
  disabled?: boolean;
}
type Selection = number | string | Array<number | string>;
type Props = Omit<SelectProps<Selection>, "options" | "loading">;

/**
 * 小型组织字典共享同一个缓存；由服务端决定哪些角色可以被当前操作者授予。
 * 选项加载失败提供就地重试，不将网络失败伪装为“没有选项”。值只传递稳定 ID。
 */
export function OrganizationSelect({
  kind,
  ...props
}: Props & { kind: "roles" | "posts" }) {
  const query = useQuery({
    queryKey: ["lookups"],
    queryFn: () => api<Lookups>("/system/lookups"),
  });
  return (
    <Select
      {...props}
      showSearch={{ optionFilterProp: "label" }}
      allowClear
      loading={query.isLoading}
      status={query.isError ? "error" : props.status}
      notFoundContent={
        query.isError ? (
          <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
        ) : undefined
      }
      options={query.data?.[kind].map((item) => ({
        value: item.id,
        label: item.name,
      }))}
    />
  );
}
export const RoleSelect = (props: Props) => (
  <OrganizationSelect kind="roles" placeholder="请选择角色" {...props} />
);
export const PostSelect = (props: Props) => (
  <OrganizationSelect kind="posts" placeholder="请选择岗位" {...props} />
);

/**
 * 大量人员、分类和标签按关键词从服务端分页查找，只请求最小选项字段。
 * 已选项缓存仅用于当前组件显示名称，不把联系方式或选项数据写入浏览器持久存储。
 * 旧请求取消且关键词进入 queryKey，避免快速输入后出现上一关键词的结果。
 */
export function RemoteSelect({
  kind,
  initialOptions = [],
  ...props
}: Props & {
  kind: "users" | "categories" | "tags" | "approvalcategories";
  initialOptions?: LookupOption[];
}) {
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [known, setKnown] = useState<LookupOption[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ["options", kind, keyword, page],
    queryFn: ({ signal }) =>
      api<PageResult<LookupOption>>(
        `/system/options/${kind}?${queryString({ keyword, page, size: 30 })}`,
        { signal },
      ),
  });
  useEffect(() => {
    if (!query.data) return;
    setKnown((previous) => {
      const values = new Set(
        Array.isArray(props.value) ? props.value : [props.value],
      );
      const retained =
        page === 1
          ? previous.filter((item) => values.has(item.value))
          : previous;
      return Array.from(
        new Map(
          [...retained, ...query.data.items].map((item) => [item.value, item]),
        ).values(),
      );
    });
  }, [query.data, page, props.value]);
  return (
    <Select
      {...props}
      allowClear
      showSearch={{ filterOption: false, onSearch: setSearch }}
      loading={query.isFetching}
      options={Array.from(
        new Map(
          [...initialOptions, ...known].map((item) => [item.value, item]),
        ).values(),
      )}
      status={query.isError ? "error" : props.status}
      notFoundContent={
        query.isLoading ? (
          <Spin size="small" />
        ) : query.isError ? (
          <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无匹配项"
          />
        )
      }
      popupRender={(menu) => (
        <>
          {menu}
          {query.data && page * query.data.size < query.data.total && (
            <Button
              block
              type="text"
              disabled={query.isFetching}
              onClick={() => setPage(page + 1)}
            >
              加载更多
            </Button>
          )}
        </>
      )}
    />
  );
}
export const UserSelect = (
  props: Props & { initialOptions?: LookupOption[] },
) => <RemoteSelect kind="users" placeholder="搜索人员姓名或账号" {...props} />;
export const CategorySelect = (
  props: Props & { initialOptions?: LookupOption[] },
) => <RemoteSelect kind="categories" placeholder="请选择分类" {...props} />;
export const TagSelect = (
  props: Props & { initialOptions?: LookupOption[] },
) => (
  <RemoteSelect
    kind="tags"
    mode="multiple"
    placeholder="请选择标签"
    {...props}
  />
);
