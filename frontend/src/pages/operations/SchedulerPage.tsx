import { useRef, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Switch,
  Tag,
} from "antd";
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
  controlScheduledExecution,
} from "../../lib/general-platform";
import { useAuth } from "../../lib/auth";
import type { ScheduledJob } from "../../lib/general-platform";

const executionStatusNames: Record<string, string> = {
  SUCCESS: "成功",
  FAILED: "失败",
  QUEUED: "等待执行",
  RUNNING: "执行中",
  CANCELLED: "已取消",
};

/** 调度只选择服务器注册处理器；页级历史包含已删除配置，行级历史仍限定原任务，不提供脚本输入。 */
export function SchedulerPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const [selected, setSelected] = useState<ScheduledJob | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [controlling, setControlling] = useState<number | null>(null);
  const executionKeys = useRef(new Map<number, string>());
  const handlers = useQuery({
    queryKey: ["scheduler-handlers"],
    queryFn: schedulerHandlers,
  });
  const recipients = useQuery({
    queryKey: ["scheduler-recipients"],
    queryFn: schedulerRecipients,
  });
  const executions = useQuery({
    queryKey: ["job-logs", selected?.id, search, page],
    queryFn: () => jobExecutions(selected?.id, page, search),
    enabled: historyOpen,
    refetchInterval: historyOpen ? 10000 : false,
  });
  /** 每次打开重新定位第一页与查询范围，避免上一个配置或关键字影响全历史入口。 */
  function openHistory(record: ScheduledJob | null) {
    setSelected(record);
    setKeyword("");
    setSearch("");
    setPage(1);
    setHistoryOpen(true);
  }
  return (
    <>
      <ResourcePage<ScheduledJob>
        resource="scheduler"
        endpoint="/operations/scheduler"
        title="任务调度"
        singular="任务"
        extraToolbar={
          can("scheduler:view") && (
            <Button onClick={() => openHistory(null)}>执行记录</Button>
          )
        }
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
            onClick: () => openHistory(record),
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
              const key =
                executionKeys.current.get(record.id) ?? crypto.randomUUID();
              executionKeys.current.set(record.id, key);
              const result = await runScheduledJob(record.id, key);
              executionKeys.current.delete(record.id);
              if (result.status === "SUCCESS") message.success(result.result);
              else if (result.status === "FAILED") message.error(result.result);
              else message.info(result.result);
              openHistory(record);
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
        title={selected ? `${selected.name} · 执行记录` : "执行记录"}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={1000}
      >
        <div className="table-toolbar">
          <div className="filters">
            <Input.Search
              aria-label="搜索执行记录任务名称"
              placeholder="搜索任务名称"
              maxLength={200}
              allowClear
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                if (!event.target.value) {
                  setSearch("");
                  setPage(1);
                }
              }}
              onSearch={(value) => {
                setSearch(value.trim());
                setPage(1);
              }}
              enterButton="查询"
            />
          </div>
          <Button
            loading={executions.isFetching}
            onClick={() => void executions.refetch()}
          >
            刷新执行记录
          </Button>
        </div>
        <QueryState
          loading={executions.isLoading}
          error={executions.error}
          retry={() => void executions.refetch()}
        >
          <DataTable
            rowKey="id"
            aria-label="任务执行记录"
            dataSource={executions.data?.items ?? []}
            columns={[
              {
                title: "任务名称",
                dataIndex: "jobName",
                width: 170,
                ellipsis: true,
              },
              {
                title: "结果",
                dataIndex: "status",
                width: 100,
                render: (value: string) => (
                  <Tag
                    color={
                      value === "SUCCESS"
                        ? "success"
                        : value === "FAILED"
                          ? "error"
                          : "processing"
                    }
                  >
                    {executionStatusNames[value] ?? value}
                  </Tag>
                ),
              },
              {
                title: "说明",
                dataIndex: "result",
                width: 260,
                ellipsis: true,
              },
              { title: "耗时(ms)", dataIndex: "durationMs", width: 110 },
              {
                title: "尝试",
                key: "attempts",
                width: 70,
                render: (_, record) =>
                  "attempts" in record && typeof record.attempts === "number"
                    ? record.attempts
                    : 0,
              },
              {
                title: "执行时间",
                dataIndex: "createdAt",
                width: 180,
                render: formatTime,
              },
              {
                title: "操作",
                key: "actions",
                width: 90,
                render: (_, record) =>
                  can("scheduler:execute") &&
                  ["QUEUED", "RUNNING", "FAILED", "CANCELLED"].includes(
                    record.status ?? "",
                  ) ? (
                    <Popconfirm
                      title={
                        ["QUEUED", "RUNNING"].includes(record.status ?? "")
                          ? "取消本次执行？"
                          : "按原配置恢复本次执行？"
                      }
                      onConfirm={async () => {
                        if (!record.id || controlling !== null) return;
                        setControlling(record.id);
                        try {
                          await controlScheduledExecution(
                            record.id,
                            ["QUEUED", "RUNNING"].includes(record.status ?? "")
                              ? "cancel"
                              : "retry",
                          );
                          await executions.refetch();
                          message.success("执行状态已更新");
                        } catch (error) {
                          message.error((error as Error).message);
                        } finally {
                          setControlling(null);
                        }
                      }}
                    >
                      <Button
                        type="link"
                        size="small"
                        disabled={controlling !== null}
                        loading={controlling === record.id}
                      >
                        {["QUEUED", "RUNNING"].includes(record.status ?? "")
                          ? "取消"
                          : "恢复"}
                      </Button>
                    </Popconfirm>
                  ) : null,
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
        </QueryState>
      </DetailsModal>
    </>
  );
}
