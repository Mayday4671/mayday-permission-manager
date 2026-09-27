import { useState } from "react";
import { App, Button, Tag } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";
import { MessageDetailModal } from "../../components/MessageDetailModal";
import { formatTime } from "../../components/shared";
import { api } from "../../lib/api";
import { notificationTypes, type InboxRecord } from "../../types/notifications";

/** 收件箱只请求当前账号的独立投递；详情与工作台共用同一读取、鉴权和已读处理组件。 */
export function MessagesPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const { message } = App.useApp();
  const client = useQueryClient();
  const [markingAll, setMarkingAll] = useState(false);
  return (
    <>
      <ResourcePage<InboxRecord>
        resource="messages"
        endpoint="/operations/messages"
        title="个人收件箱"
        singular="通知"
        readOnly
        fields={() => null}
        statusField="read"
        statusLabels={["已读", "未读"]}
        extraToolbar={
          <Button
            loading={markingAll}
            onClick={async () => {
              setMarkingAll(true);
              try {
                await api("/operations/messages/read-all", { method: "POST" });
                await Promise.all([
                  client.invalidateQueries({ queryKey: ["messages"] }),
                  client.invalidateQueries({ queryKey: ["unread"] }),
                ]);
                message.success("已全部标记为已读");
              } catch (error) {
                message.error((error as Error).message);
              } finally {
                setMarkingAll(false);
              }
            }}
          >
            全部已读
          </Button>
        }
        columns={[
          { title: "标题", dataIndex: "title", width: 320 },
          { title: "摘要", dataIndex: "summary", width: 280, ellipsis: true },
          {
            title: "类型",
            dataIndex: "type",
            width: 90,
            render: (v) =>
              notificationTypes.find((t) => t.value === v)?.label ?? v,
          },
          { title: "发件人", dataIndex: "senderName", width: 120 },
          {
            title: "状态",
            width: 100,
            render: (_, r) => (
              <Tag color={r.readAt ? "default" : "blue"}>
                {r.readAt ? "已读" : "未读"}
              </Tag>
            ),
          },
          {
            title: "发送时间",
            dataIndex: "publishedAt",
            width: 170,
            render: formatTime,
          },
        ]}
        extraActions={(row) => (
          <Button type="link" onClick={() => setSelected(row.id)}>
            查看
          </Button>
        )}
      />
      <MessageDetailModal id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
