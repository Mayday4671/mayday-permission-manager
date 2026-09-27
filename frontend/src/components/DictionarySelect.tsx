import { Button, Select, Tag, type SelectProps } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export interface DictionaryOption {
  value: string;
  label: string;
  color: string;
}
/** 业务只传字典编码；选项的标签、排序、颜色和启停均来自维护后的服务器数据。 */
export function useDictionary(code: string) {
  return useQuery({
    queryKey: ["dictionary-options", code],
    queryFn: ({ signal }) =>
      api<DictionaryOption[]>(
        `/system/dictionary-options/${encodeURIComponent(code)}`,
        { signal },
      ),
  });
}
export function DictionarySelect({
  code,
  ...props
}: SelectProps & { code: string }) {
  const query = useDictionary(code);
  return (
    <Select
      {...props}
      showSearch={{ optionFilterProp: "label" }}
      loading={query.isLoading}
      options={query.data}
      status={query.isError ? "error" : props.status}
      notFoundContent={
        query.isError ? (
          <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
        ) : undefined
      }
    />
  );
}
export function DictionaryTag({
  code,
  value,
  fallback,
}: {
  code: string;
  value: string;
  fallback?: string;
}) {
  const query = useDictionary(code);
  const item = query.data?.find((option) => option.value === value);
  return (
    <Tag color={item?.color ?? "default"}>
      {item?.label ?? fallback ?? value}
    </Tag>
  );
}
