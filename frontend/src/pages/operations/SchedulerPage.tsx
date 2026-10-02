import { useState } from "react";
import { App, Button, Form, Input, Select, Switch, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";
import { DetailsModal } from "../../components/DetailsModal";
import { DataTable } from "../../components/DataTable";
import { formatTime, QueryState, StatusTag } from "../../components/shared";
import {
  schedulerHandlers,
  schedulerRecipients,
  jobExecutions,
  runScheduledJob,
} from "../../lib/general-platform";
import { useAuth } from "../../lib/auth";
import type { ScheduledJob } from "../../lib/general-platform";

/** 调度只选择服务器注册处理器；执行记录按任务和分页重新查询，不提供脚本或类名输入。 */
export function SchedulerPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const [selected, setSelected] = useState<ScheduledJob | null>(null);
  const [page, setPage] = useState(1);
  const handlers = useQuery({
    queryKey: ["scheduler-handlers"],
    queryFn: schedulerHandlers,
  });
  const recipients = useQuery({
    queryKey: ["scheduler-recipients"],
    queryFn: schedulerRecipients,
  });
  const executions = useQuery({
    queryKey: ["job-logs", selected?.id, page],
    queryFn: () => {
      if (!selected) throw new Error("请选择任务");
      return jobExecutions(selected.id, page);
    },
    enabled: !!selected,
    refetchInterval: selected ? 10000 : false,
  });
  return (
    <>
      <ResourcePage<ScheduledJob>
        resource="scheduler"
        endpoint="/operations/scheduler"
        title="任务调度"
        singular="任务"
        statusField="enabled"
        defaults={{
          handler: "DATABASE_CHECK",
          cron: "0 */5 * * * *",
          enabled: false,
        }}
        columns={[
          { title: "任务名称", dataIndex: "name", width: 240 },
          {
            title: "处理器",
            dataIndex: "handler",
            width: 180,
            render: (value: string) => handlers.data?.[value] || value,
          },
          { title: "Cron", dataIndex: "cron", width: 180 },
          {
            title: "状态",
            dataIndex: "enabled",
            width: 100,
            render: (value: boolean) => <StatusTag enabled={value} />,
          },
          {
            title: "下次执行",
            dataIndex: "nextRunAt",
            width: 180,
            render: formatTime,
          },
        ]}
        rowActions={(record) => [
          {
            key: "history",
            label: "执行记录",
            onClick: () => {
              setPage(1);
              setSelected(record);
            },
          },
          {
            key: "run",
            label: "立即执行",
            hidden: !can("scheduler:execute"),
            confirm: {
              title: "执行此任务？",
              description: "将立即执行一次注册处理器，不改变自动执行开关。",
            },
            onClick: async () => {
              const result = await runScheduledJob(record.id);
              if (result.status === "SUCCESS") message.success(result.result);
              else message.error(result.result);
              setPage(1);
              setSelected(record);
            },
          },
        ]}
        fields={() => (
          <>
            <Form.Item
              name="name"
              label="任务名称"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item
              name="handler"
              label="处理器"
              rules={[{ required: true }]}
            >
              <Select
                loading={handlers.isLoading}
                options={Object.entries(handlers.data ?? {}).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </Form.Item>
            <Form.Item
              name="cron"
              label="Cron（秒 分 时 日 月 星期）"
              rules={[{ required: true }]}
            >
              <Input maxLength={100} placeholder="0 */5 * * * *" />
            </Form.Item>
            <Form.Item name="alertUserId" label="失败提醒接收人">
              <Select
                allowClear
                showSearch={{ optionFilterProp: "label" }}
                options={recipients.data}
                loading={recipients.isLoading}
              />
            </Form.Item>
            <Form.Item name="description" label="说明">
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
            <Form.Item name="enabled" label="自动执行" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}
      />
      <DetailsModal
        title={`${selected?.name ?? "任务"} · 执行记录`}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={1000}
      >
        <QueryState
          loading={executions.isLoading}
          error={executions.error}
          retry={() => void executions.refetch()}
        >
          <DataTable
            rowKey="id"
            dataSource={executions.data?.items ?? []}
            columns={[
              {
                title: "结果",
                dataIndex: "status",
                width: 100,
                render: (value: string) => (
                  <Tag color={value === "SUCCESS" ? "success" : "error"}>
                    {value === "SUCCESS" ? "成功" : "失败"}
                  </Tag>
                ),
              },
              {
                title: "说明",
                dataIndex: "result",
                width: 430,
                ellipsis: true,
              },
              { title: "耗时(ms)", dataIndex: "durationMs", width: 110 },
              {
                title: "执行时间",
                dataIndex: "createdAt",
                width: 180,
                render: formatTime,
              },
            ]}
            pagination={{
              current: page,
              pageSize: 5,
              total: executions.data?.total,
              showSizeChanger: false,
              onChange: setPage,
            }}
          />
          {can("scheduler:view") && (
            <Button onClick={() => void executions.refetch()}>刷新</Button>
          )}
        </QueryState>
      </DetailsModal>
    </>
  );
}
