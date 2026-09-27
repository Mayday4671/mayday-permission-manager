import { Button, TreeSelect } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Lookups } from "../types";

/**
 * 公用部门选择器，展示父子层级但严格选择明确的部门 ID。
 * 指定父部门不隐式勾选下级，避免把“自定义部门”误变为“部门及下级”。
 */
export function DepartmentSelect({
  value,
  onChange,
  disabled = false,
}: {
  value?: number[];
  onChange?: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const query = useQuery({
    queryKey: ["lookups"],
    queryFn: () => api<Lookups>("/system/lookups"),
  });
  return (
    <TreeSelect
      style={{ width: "100%" }}
      aria-label="指定可访问部门"
      value={(value ?? []).map((id) => ({ value: id }))}
      onChange={(nodes) => onChange?.(nodes.map((node) => Number(node.value)))}
      multiple
      treeCheckable
      treeCheckStrictly
      treeDataSimpleMode
      treeNodeFilterProp="title"
      showSearch
      allowClear
      disabled={disabled}
      loading={query.isLoading}
      placeholder="请选择部门"
      status={query.isError ? "error" : undefined}
      notFoundContent={
        query.isError ? (
          <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
        ) : undefined
      }
      treeData={query.data?.departments.map((department) => ({
        id: department.id,
        pId: department.parentId,
        value: department.id,
        title: department.name,
        disabled: !department.enabled,
      }))}
    />
  );
}

/** 单部门选择用于人员所属部门和组织上级；多选授权使用上方严格勾选组件。 */
export function DepartmentField({
  value,
  onChange,
  disabled,
  excludeId,
  id,
}: {
  value?: number | null;
  onChange?: (id?: number) => void;
  disabled?: boolean;
  excludeId?: number;
  id?: string;
}) {
  const query = useQuery({
    queryKey: ["lookups"],
    queryFn: () => api<Lookups>("/system/lookups"),
  });
  return (
    <TreeSelect
      id={id}
      value={value ?? undefined}
      onChange={onChange}
      disabled={disabled}
      style={{ width: "100%" }}
      allowClear
      showSearch
      treeDataSimpleMode
      treeNodeFilterProp="title"
      placeholder="请选择部门"
      loading={query.isLoading}
      status={query.isError ? "error" : undefined}
      notFoundContent={
        query.isError ? (
          <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
        ) : undefined
      }
      treeData={query.data?.departments.map((department) => ({
        id: department.id,
        pId: department.parentId,
        value: department.id,
        title: department.name,
        disabled: !department.enabled || department.id === excludeId,
      }))}
    />
  );
}
