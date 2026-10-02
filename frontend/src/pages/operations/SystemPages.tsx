import { App, Button, Popconfirm, Tag } from "antd";
import { ResourcePage } from "../../components/ResourcePage";

import { formatTime } from "../../components/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { SessionRecord } from "../../types/operations";

/** 会话列表与撤销入口共用服务器鉴权和目标保护；撤销完成刷新列表，不在前端缓存登录令牌明文。 */
export function SessionsPage() {
  const { can } = useAuth();
  const { message } = App.useApp();
  return (
    <ResourcePage<SessionRecord>
      resource="sessions"
      endpoint="/operations/sessions"
      title="在线用户"
      singular="用户"
      readOnly
      fields={() => null}
      columns={[
        {
          title: "用户",
          width: 170,
          render: (_, r) => (
            <span>
              {r.nickname} {r.current && <Tag color="blue">当前会话</Tag>}
              <small className="block-muted">{r.username}</small>
            </span>
          ),
        },
        { title: "登录 IP", dataIndex: "ip", width: 130 },
        {
          title: "浏览器 / 设备",
          dataIndex: "device",
          ellipsis: true,
          width: 300,
        },
        {
          title: "登录时间",
          dataIndex: "createdAt",
          render: formatTime,
          width: 180,
        },
        {
          title: "最后活跃",
          dataIndex: "lastActiveAt",
          render: formatTime,
          width: 180,
        },
        {
          title: "失效时间",
          dataIndex: "expiresAt",
          render: formatTime,
          width: 180,
        },
      ]}
      extraActions={(r, refresh) =>
        can("sessions:revoke") && (
          <Popconfirm
            title="强制该会话下线？"
            description={r.current ? "当前页面也会退出登录。" : undefined}
            onConfirm={async () => {
              try {
                await api("/operations/sessions/" + r.id, { method: "DELETE" });
                message.success("会话已撤销");
                refresh();
              } catch (e) {
                message.error((e as Error).message);
              }
            }}
          >
            <Button type="link" danger>
              下线
            </Button>
          </Popconfirm>
        )
      }
    />
  );
}
