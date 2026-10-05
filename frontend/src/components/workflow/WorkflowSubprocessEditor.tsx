import { useState } from "react";
import { Alert, Button, Select, Space, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { PageResult } from "../../types";
import type {
  WorkflowField,
  WorkflowNode,
  WorkflowOption,
} from "../../types/workflow";
import { QueryState } from "../shared";
import { compatibleWorkflowField } from "../../lib/workflowSubprocess";

type Binding = NonNullable<WorkflowNode["subprocess"]>;
interface VersionView {
  definitionId: number;
  name: string;
  versionId: number;
  versionNumber: number;
  fields: WorkflowField[];
}

/** 固定版本与字段映射的受控表单；版本切换清空旧映射，不能把同名字段当作稳定兼容引用。 */
export function WorkflowSubprocessEditor({
  value,
  onChange,
  fields,
  readable,
  writable,
}: {
  value?: Binding | null;
  onChange?: (binding: Binding) => void;
  fields: WorkflowField[];
  readable: string[];
  writable: string[];
}) {
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["workflows", "subprocess-options", keyword, page],
    queryFn: () =>
      api<PageResult<WorkflowOption>>(
        `/operations/workflows/subprocess-options?keyword=${encodeURIComponent(keyword)}&page=${page}&size=10`,
      ),
  });
  const selected = useQuery({
    queryKey: ["workflows", "subprocess-version", value?.versionId],
    enabled: !!value?.versionId,
    queryFn: () =>
      api<VersionView>(
        `/operations/workflows/subprocess-versions/${value?.versionId}`,
      ),
  });
  const options = (query.data?.items ?? []).map((item) => ({
    value: item.versionId,
    label: `${item.name} · 版本 ${item.versionNumber}`,
  }));
  if (
    selected.data &&
    !options.some((item) => item.value === selected.data.versionId)
  )
    options.unshift({
      value: selected.data.versionId,
      label: `${selected.data.name} · 版本 ${selected.data.versionNumber}`,
    });
  const update = (
    kind: "inputs" | "outputs",
    key: string,
    fieldId: string | undefined,
  ) => {
    const mapping = { ...(value?.[kind] ?? {}) };
    if (fieldId) mapping[key] = fieldId;
    else delete mapping[key];
    onChange?.({
      versionId: value?.versionId ?? null,
      inputs: value?.inputs ?? {},
      outputs: value?.outputs ?? {},
      [kind]: mapping,
    });
  };
  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Select
        aria-label="子流程发布版本"
        style={{ width: "100%" }}
        showSearch={{
          onSearch: (search) => {
            setKeyword(search);
            setPage(1);
          },
          filterOption: false,
        }}
        placeholder="搜索并选择已发布的通用流程"
        value={value?.versionId ?? undefined}
        loading={query.isLoading}
        options={options}
        onChange={(versionId) =>
          onChange?.({ versionId, inputs: {}, outputs: {} })
        }
        popupRender={(menu) => (
          <>
            {menu}
            <Space style={{ padding: 8 }}>
              <Button
                size="small"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                上一页
              </Button>
              <span>第 {page} 页</span>
              <Button
                size="small"
                disabled={!query.data || page * 10 >= query.data.total}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </Space>
          </>
        )}
      />
      {query.isError && (
        <Alert
          type="error"
          title="子流程目录加载失败"
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      )}
      <Alert
        type="info"
        title="执行始终使用当前绑定版本。输入按子表单字段匹配父表单；通过后才回填输出。退回、撤回和终止会传播到运行中的子流程。"
      />
      {selected.isLoading && <Spin />}
      {value?.versionId && (
        <QueryState
          loading={selected.isLoading}
          error={selected.error}
          retry={() => void selected.refetch()}
        >
          {selected.data && (
            <>
              <b>输入映射</b>
              {selected.data.fields
                .filter((field) => field.type !== "CALCULATED")
                .map((child) => (
                  <div className="workflow-mapping-row" key={`in:${child.id}`}>
                    <label>
                      {child.label}
                      {child.required ? " *" : ""}
                    </label>
                    <Select
                      allowClear
                      aria-label={`子流程输入：${child.label}`}
                      placeholder="父表单字段"
                      value={value.inputs[child.id]}
                      status={
                        child.required && !value.inputs[child.id]
                          ? "warning"
                          : undefined
                      }
                      options={fields
                        .filter(
                          (parent) =>
                            readable.includes(parent.id) &&
                            compatibleWorkflowField(parent, child),
                        )
                        .map((field) => ({
                          value: field.id,
                          label: field.label,
                        }))}
                      onChange={(fieldId) =>
                        update("inputs", child.id, fieldId)
                      }
                    />
                  </div>
                ))}
              <b>输出映射</b>
              {fields
                .filter(
                  (field) =>
                    writable.includes(field.id) && field.type !== "CALCULATED",
                )
                .map((parent) => (
                  <div
                    className="workflow-mapping-row"
                    key={`out:${parent.id}`}
                  >
                    <label>{parent.label}</label>
                    <Select
                      allowClear
                      aria-label={`子流程输出：${parent.label}`}
                      placeholder="子表单字段"
                      value={value.outputs[parent.id]}
                      options={selected
                        .data!.fields.filter((child) =>
                          compatibleWorkflowField(child, parent),
                        )
                        .map((field) => ({
                          value: field.id,
                          label: field.label,
                        }))}
                      onChange={(fieldId) =>
                        update("outputs", parent.id, fieldId)
                      }
                    />
                  </div>
                ))}
              {!writable.length && (
                <span className="muted">
                  需要回填时，先在字段权限中开放目标字段的可写权限。
                </span>
              )}
            </>
          )}
        </QueryState>
      )}
    </Space>
  );
}
