import { useState } from "react";
import { Button, Descriptions } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ResourcePage } from "../components/ResourcePage";
import { DetailsModal } from "../components/DetailsModal";
import { DataTable } from "../components/DataTable";
import { QueryState, formatTime } from "../components/shared";
import { changeDetail } from "../lib/general-platform";
import type { ChangeRecord } from "../lib/general-platform";

/** 可读的业务变更与请求日志独立展示；详情重新读取，授权撤销后不会继续展示旧查询数据。 */
export function ChangesPage() {
  const [id, setId] = useState<number | null>(null);
  const detail = useQuery({
    queryKey: ["change-detail", id],
    queryFn: () => {
      if (id === null) throw new Error("请选择变更记录");
      return changeDetail(id);
    },
    enabled: id !== null,
  });
  return (
    <>
      <ResourcePage<ChangeRecord>
        resource="logs"
        endpoint="/system/changes"
        title="变更记录"
        singular="变更"
        readOnly
        fields={() => null}
        columns={[
          { title: "操作人", dataIndex: "actor", width: 150 },
          { title: "对象", dataIndex: "resource", width: 120 },
          { title: "对象编号", dataIndex: "resourceId", width: 120 },
          { title: "变更动作", dataIndex: "action", width: 240 },
          {
            title: "时间",
            dataIndex: "createdAt",
            render: formatTime,
            width: 180,
          },
        ]}
        extraActions={(record) => (
          <Button type="link" onClick={() => setId(record.id)}>
            查看差异
          </Button>
        )}
      />
      <DetailsModal
        title="变更详情"
        open={id !== null}
        onClose={() => setId(null)}
        width={880}
      >
        <QueryState
          loading={detail.isLoading}
          error={detail.error}
          retry={() => void detail.refetch()}
        >
          {detail.data && (
            <>
              <Descriptions
                column={2}
                items={[
                  {
                    key: "actor",
                    label: "操作人",
                    children: detail.data.actor,
                  },
                  {
                    key: "action",
                    label: "动作",
                    children: detail.data.action,
                  },
                  {
                    key: "object",
                    label: "对象",
                    children: `${detail.data.resource} #${detail.data.resourceId}`,
                  },
                  {
                    key: "time",
                    label: "时间",
                    children: formatTime(detail.data.createdAt),
                  },
                ]}
              />
              <DataTable
                rowKey="field"
                dataSource={detail.data.changes}
                columns={[
                  { title: "字段", dataIndex: "field", width: 140 },
                  {
                    title: "修改前",
                    dataIndex: "before",
                    width: 280,
                    ellipsis: true,
                  },
                  {
                    title: "修改后",
                    dataIndex: "after",
                    width: 280,
                    ellipsis: true,
                  },
                ]}
                pagination={{ pageSize: 6, showSizeChanger: false }}
              />
            </>
          )}
        </QueryState>
      </DetailsModal>
    </>
  );
}
