import { useState } from "react";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tag,
} from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { api, jsonBody } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { PageResult } from "../types";
import { DataTable } from "./DataTable";
import { DetailsModal } from "./DetailsModal";
import { FormModal } from "./FormModal";
import { UserSelect } from "./LookupSelect";
import { QueryState, formatTime } from "./shared";

interface Delegation {
  id: number;
  version: number;
  ownerName: string;
  targetName: string;
  startsAt: string;
  endsAt: string;
  definitionIds: number[];
  reason: string;
  status: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "REVOKED";
}
interface Arrangement {
  targetId: number;
  period: [Dayjs, Dayjs];
  definitionIds?: number[];
  reason: string;
}
const statusNames = {
  ACTIVE: "生效中",
  SCHEDULED: "未开始",
  EXPIRED: "已到期",
  REVOKED: "已撤销",
};

/** 临时委托独立配置有效期和流程范围；仅设置后续任务，不隐式接管已经激活的待办。 */
export function WorkflowDelegationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { can } = useAuth(),
    { message } = App.useApp();
  const [box, setBox] = useState("mine"),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false);
  const [form] = Form.useForm<Arrangement>();
  const query = useQuery({
    queryKey: ["delegations", box, page],
    queryFn: () =>
      api<PageResult<Delegation>>(
        `/operations/delegations?box=${box}&page=${page}&size=6`,
      ),
    enabled: open,
  });
  const scopes = useQuery({
    queryKey: ["delegations", "scopes"],
    queryFn: () =>
      api<{ value: number; label: string }[]>("/operations/delegations/scopes"),
    enabled: open,
  });
  return (
    <>
      <DetailsModal title="审批委托" open={open} onClose={onClose} width={1000}>
        <Space wrap className="form-message">
          <Segmented
            options={[
              { label: "我创建的", value: "mine" },
              { label: "我收到的", value: "received" },
            ]}
            value={box}
            onChange={(value) => {
              setBox(String(value));
              setPage(1);
            }}
          />
          {can("users:view") && (
            <Button
              type="primary"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  period: [dayjs(), dayjs().add(1, "day")],
                });
                setCreating(true);
              }}
            >
              新增委托
            </Button>
          )}
          <Button onClick={() => void query.refetch()}>刷新</Button>
        </Space>
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        >
          <DataTable<Delegation>
            rowKey="id"
            size="small"
            dataSource={query.data?.items ?? []}
            pagination={{
              current: page,
              pageSize: 6,
              total: query.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            columns={[
              { title: "原审批人", dataIndex: "ownerName", width: 105 },
              { title: "受托人", dataIndex: "targetName", width: 105 },
              {
                title: "有效时段",
                width: 210,
                render: (_, row) => (
                  <>
                    {formatTime(row.startsAt)}
                    <br />
                    {formatTime(row.endsAt)}
                  </>
                ),
              },
              {
                title: "流程范围",
                width: 150,
                render: (_, row) =>
                  row.definitionIds.length
                    ? row.definitionIds
                        .map(
                          (id) =>
                            scopes.data?.find((s) => s.value === id)?.label ??
                            `流程 ${id}`,
                        )
                        .join("、")
                    : "全部流程",
              },
              { title: "原因", dataIndex: "reason", ellipsis: true },
              {
                title: "状态",
                dataIndex: "status",
                width: 90,
                render: (value: Delegation["status"]) => (
                  <Tag color={value === "ACTIVE" ? "success" : undefined}>
                    {statusNames[value]}
                  </Tag>
                ),
              },
              ...(box === "mine"
                ? [
                    {
                      title: "操作",
                      width: 80,
                      render: (_: unknown, row: Delegation) =>
                        ["ACTIVE", "SCHEDULED"].includes(row.status) ? (
                          <Popconfirm
                            title="撤销委托？"
                            description="已激活的任务仍由原受托人办理。"
                            onConfirm={async () => {
                              await api(
                                `/operations/delegations/${row.id}/revoke`,
                                {
                                  method: "POST",
                                  body: jsonBody({ version: row.version }),
                                },
                              );
                              message.success("委托已撤销");
                              await query.refetch();
                            }}
                          >
                            <Button type="link">撤销</Button>
                          </Popconfirm>
                        ) : (
                          "—"
                        ),
                    },
                  ]
                : []),
            ]}
          />
        </QueryState>
      </DetailsModal>
      <FormModal
        title="新增审批委托"
        open={creating}
        form={form}
        onCancel={() => setCreating(false)}
        onSubmit={async (values) => {
          await api("/operations/delegations", {
            method: "POST",
            body: jsonBody({
              targetId: values.targetId,
              startsAt: values.period[0].format("YYYY-MM-DDTHH:mm:ss"),
              endsAt: values.period[1].format("YYYY-MM-DDTHH:mm:ss"),
              definitionIds: values.definitionIds ?? [],
              reason: values.reason,
            }),
          });
          message.success("委托已保存");
          setCreating(false);
          setBox("mine");
          setPage(1);
          await query.refetch();
        }}
      >
        <Alert
          type="info"
          className="form-message"
          title="仅影响后续激活的审批任务"
          description="已激活的任务保持原归属；撤销或到期不会自动收回。受托人仍须具有审批权限，自审、重复审批和转委托会被阻止。"
        />
        <Form.Item
          name="targetId"
          label="受托人"
          rules={[{ required: true, message: "请选择受托人" }]}
        >
          <UserSelect />
        </Form.Item>
        <Form.Item
          name="period"
          label="有效时段"
          rules={[
            { required: true, message: "请选择起止时间" },
            {
              validator: (_, value: [Dayjs, Dayjs] | undefined) =>
                !value ||
                (value[1].isAfter(value[0]) &&
                  value[1].diff(value[0], "day", true) <= 90)
                  ? Promise.resolve()
                  : Promise.reject(
                      new Error("结束时间须晚于开始时间，最长90天"),
                    ),
            },
          ]}
        >
          <DatePicker.RangePicker showTime style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="definitionIds"
          label="流程范围"
          extra="留空表示全部流程。"
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="全部流程"
            options={scopes.data}
            loading={scopes.isLoading}
            status={scopes.isError ? "error" : undefined}
          />
        </Form.Item>
        {scopes.isError && (
          <Button onClick={() => void scopes.refetch()}>
            范围加载失败，重试
          </Button>
        )}
        <Form.Item
          name="reason"
          label="委托原因"
          rules={[
            { required: true, whitespace: true, message: "请填写委托原因" },
            { max: 500 },
          ]}
        >
          <Input.TextArea rows={3} maxLength={500} showCount />
        </Form.Item>
      </FormModal>
    </>
  );
}
