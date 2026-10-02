import { useEffect, useState } from "react";
import { Button, Segmented, Select, Space, Tag } from "antd";
import { Plus, Eye } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ResourcePage } from "../../components/ResourcePage";
import { ApprovalSubmitModal } from "../../components/ApprovalSubmitModal";
import { ApprovalDetailModal } from "../../components/ApprovalDetailModal";
import { formatTime } from "../../components/shared";
import { useAuth } from "../../lib/auth";
import { usePageState } from "../../lib/workspace";
import { approvalStates, type ApprovalRecord } from "../../types/workflow";
/** 申请列表和个人待办复用同一资源页，通过服务端 box 条件分别控制参与范围。 */
function Approvals({ tasks = false }: { tasks?: boolean }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = usePageState<string | undefined>(
    "applicationStatus",
    undefined,
  );
  const [box, setBox] = usePageState<string>(
    "approvalBox",
    tasks ? "todo" : "mine",
  );
  useEffect(() => {
    const id = Number(params.get("record"));
    if (Number.isSafeInteger(id) && id > 0) setSelected(id);
  }, [params]);
  const close = () => {
    setSelected(null);
    if (params.has("record")) {
      const next = new URLSearchParams(params);
      next.delete("record");
      setParams(next, { replace: true });
    }
  };
  const options = tasks
    ? [
        { label: "待处理", value: "todo" },
        { label: "已处理", value: "done" },
      ]
    : [
        { label: "我发起的", value: "mine" },
        { label: "草稿", value: "drafts" },
        { label: "我参与的", value: "participated" },
        { label: "抄送我的", value: "copies" },
        ...(can("requests:manage")
          ? [{ label: "全部申请", value: "all" }]
          : []),
      ];
  return (
    <>
      <ResourcePage<ApprovalRecord>
        resource="requests"
        endpoint="/operations/requests"
        title={tasks ? "审批待办" : "审批申请"}
        singular="审批"
        readOnly
        fields={() => null}
        actionsWidth={80}
        queryParams={{ box, status }}
        savedFilters={{
          keys: ["box", "status"],
          apply: (values) => {
            setStatus(
              typeof values.status === "string" &&
                [
                  "DRAFT",
                  "PENDING",
                  "RETURNED",
                  "APPROVED",
                  "REJECTED",
                  "WITHDRAWN",
                  "CANCELLED",
                ].includes(values.status)
                ? values.status
                : undefined,
            );
            setBox(
              typeof values.box === "string" &&
                options.some((item) => item.value === values.box)
                ? values.box
                : tasks
                  ? "todo"
                  : "mine",
            );
          },
        }}
        extraFilters={
          <Space wrap>
            <Segmented
              options={options}
              value={box}
              onChange={(value) => {
                setBox(value);
                setStatus(undefined);
              }}
            />
            <Select
              aria-label="申请状态"
              allowClear
              placeholder="全部状态"
              style={{ width: 130 }}
              value={status}
              onChange={setStatus}
              options={[
                "DRAFT",
                "PENDING",
                "RETURNED",
                "APPROVED",
                "REJECTED",
                "WITHDRAWN",
                "CANCELLED",
              ].map((value) => ({
                value,
                label: value === "CANCELLED" ? "已终止" : approvalStates[value],
              }))}
            />
          </Space>
        }
        extraToolbar={
          !tasks &&
          can("requests:create") && (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => setCreating(true)}
            >
              发起审批
            </Button>
          )
        }
        columns={[
          { title: "申请标题", dataIndex: "title", width: 260 },
          { title: "流程", dataIndex: "definitionName", width: 170 },
          { title: "申请人", dataIndex: "applicantName", width: 110 },
          {
            title: "当前节点",
            dataIndex: "currentNodeName",
            width: 140,
            render: (value) => value ?? "—",
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value) => (
              <Tag
                color={
                  value === "APPROVED"
                    ? "green"
                    : value === "PENDING"
                      ? "blue"
                      : value === "REJECTED"
                        ? "red"
                        : "default"
                }
              >
                {value === "CANCELLED" ? "已终止" : approvalStates[value]}
              </Tag>
            ),
          },
          {
            title: "提交时间",
            dataIndex: "submittedAt",
            width: 175,
            render: formatTime,
          },
        ]}
        extraActions={(row) => (
          <Button
            type="text"
            aria-label="查看审批"
            title="查看审批"
            icon={<Eye size={16} />}
            onClick={() => setSelected(row.id)}
          />
        )}
      />
      <ApprovalSubmitModal
        open={creating}
        onClose={() => setCreating(false)}
        onSuccess={(record) => setSelected(record.id)}
      />
      <ApprovalDetailModal id={selected} onClose={close} />
    </>
  );
}
/** 发起与参与入口；申请信息由服务端范围过滤，不从全部待办中自行筛选。 */
export function RequestsPage() {
  return <Approvals />;
}
/** 当前处理人与历史处理入口，使用同一审批详情和决定契约保证动作权限一致。 */
export function ApprovalTasksPage() {
  return <Approvals tasks />;
}
