import { useState } from "react";
import { App, Button, DatePicker, Descriptions, Form, Tag } from "antd";
import dayjs from "dayjs";
import { Eye, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../components/ResourcePage";
import { FormModal } from "../components/FormModal";
import { DetailsModal } from "../components/DetailsModal";
import { formatTime, QueryState, StatusTag } from "../components/shared";
import { api, jsonBody } from "../lib/api";
import { exportCsv } from "../lib/export";
import { usePageState } from "../lib/workspace";
import { useAuth } from "../lib/auth";
import type { AuditLog } from "../types";

/** 操作/登录日志复用一页；导出、详情、清理均调用独立鉴权接口，详情不从列表缓存假装读取。 */
export function LogsPage({ loginOnly = false }: { loginOnly?: boolean }) {
  const { can } = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const [range, setRange] = usePageState<string[]>("logs.range", []);
  const [id, setId] = useState<number | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [form] = Form.useForm();
  const resource = loginOnly ? "loginlogs" : "logs";
  const detail = useQuery({
    queryKey: ["audit-detail", loginOnly, id],
    queryFn: () => api<AuditLog>(`/system/logs/${id}?loginOnly=${loginOnly}`),
    enabled: id !== null,
  });
  return (
    <>
      <ResourcePage<AuditLog>
        resource={resource}
        queryParams={{ loginOnly, from: range[0], to: range[1] }}
        savedFilters={{
          keys: ["from", "to"],
          apply: (values) => {
            const dates = [values.from, values.to];
            setRange(
              dates.every(
                (value) =>
                  typeof value === "string" &&
                  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
                  dayjs(value).isValid(),
              ) && String(values.from) <= String(values.to)
                ? (dates as string[])
                : [],
            );
          },
        }}
        hasExtraFilters={range.length > 0}
        onResetFilters={() => setRange([])}
        endpoint="/system/logs"
        title={loginOnly ? "登录日志" : "操作日志"}
        singular={loginOnly ? "登录记录" : "操作"}
        readOnly
        statusField="success"
        statusLabels={["成功", "失败"]}
        fields={() => null}
        extraFilters={
          <DatePicker.RangePicker
            aria-label="日志日期范围"
            value={
              range.length === 2 ? [dayjs(range[0]), dayjs(range[1])] : null
            }
            onChange={(values) =>
              setRange(
                values?.[0] && values[1]
                  ? [
                      values[0].format("YYYY-MM-DD"),
                      values[1].format("YYYY-MM-DD"),
                    ]
                  : [],
              )
            }
          />
        }
        extraToolbar={
          can(`${resource}:delete`) && (
            <Button
              danger
              icon={<Trash2 size={15} />}
              onClick={() => {
                form.resetFields();
                setCleaning(true);
              }}
            >
              清理历史日志
            </Button>
          )
        }
        exportRows={(params) =>
          exportCsv<AuditLog>({
            endpoint: "/system/logs/export",
            params,
            name: loginOnly ? "登录日志" : "操作日志",
            headers: [
              "操作人",
              "方法",
              "路径",
              "状态",
              "耗时(ms)",
              "来源 IP",
              "时间",
            ],
            row: (row) => [
              row.username,
              row.method,
              row.path,
              row.status,
              row.durationMs,
              row.ip,
              row.createdAt,
            ],
          })
        }
        extraActions={(row) => (
          <Button
            type="text"
            aria-label="查看日志详情"
            icon={<Eye size={15} />}
            onClick={() => setId(row.id)}
          />
        )}
        columns={[
          {
            title: "操作人",
            dataIndex: "username",
            width: 140,
            render: (value) => (value === "anonymous" ? "未认证访客" : value),
          },
          {
            title: "请求方式",
            dataIndex: "method",
            width: 100,
            render: (value) => (
              <Tag
                color={
                  value === "DELETE"
                    ? "red"
                    : value === "POST"
                      ? "green"
                      : "blue"
                }
              >
                {value}
              </Tag>
            ),
          },
          { title: "操作路径", dataIndex: "path", width: 290, ellipsis: true },
          {
            title: "操作结果",
            dataIndex: "status",
            width: 130,
            render: (value) => (
              <StatusTag
                enabled={value < 400}
                activeText={`成功 ${value}`}
                inactiveText={`失败 ${value}`}
              />
            ),
          },
          {
            title: "耗时",
            dataIndex: "durationMs",
            width: 100,
            render: (value) => `${value} ms`,
          },
          { title: "来源 IP", dataIndex: "ip", width: 140 },
          {
            title: "操作时间",
            dataIndex: "createdAt",
            width: 180,
            render: formatTime,
          },
        ]}
      />
      <DetailsModal
        title="日志详情"
        open={id !== null}
        onClose={() => setId(null)}
      >
        <QueryState
          loading={detail.isLoading}
          error={detail.error}
          retry={() => void detail.refetch()}
        >
          {detail.data && (
            <Descriptions
              bordered
              column={1}
              items={Object.entries({
                操作人: detail.data.username,
                请求方式: detail.data.method,
                路径: detail.data.path,
                响应状态: detail.data.status,
                耗时: `${detail.data.durationMs} ms`,
                来源IP: detail.data.ip,
                发生时间: formatTime(detail.data.createdAt),
              }).map(([label, value]) => ({
                key: label,
                label,
                children: value,
              }))}
            />
          )}
        </QueryState>
      </DetailsModal>
      <FormModal
        title={`清理${loginOnly ? "登录" : "操作"}日志`}
        open={cleaning}
        form={form}
        onCancel={() => setCleaning(false)}
        okText="确认清理"
        width={480}
        onSubmit={async (values) => {
          const count = await api<number>("/system/logs", {
            method: "DELETE",
            body: jsonBody({
              loginOnly,
              before: values.before.format("YYYY-MM-DD"),
            }),
          });
          message.success(`已清理 ${count} 条历史日志`);
          setCleaning(false);
          void client.invalidateQueries();
        }}
      >
        <p>删除所选日期之前的日志，至少保留最近 30 天。清理后无法恢复。</p>
        <Form.Item
          name="before"
          label="清理日期之前"
          rules={[{ required: true }]}
        >
          <DatePicker
            disabledDate={(date) =>
              date.isAfter(dayjs().subtract(30, "day").startOf("day"))
            }
          />
        </Form.Item>
      </FormModal>
    </>
  );
}
export const LoginLogsPage = () => <LogsPage loginOnly />;
