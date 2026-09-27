import { useState } from "react";
import { Alert, App, Button, Form, Input, Switch, Tag, Tooltip } from "antd";
import { KeyRound } from "lucide-react";
import { ResourcePage } from "../components/ResourcePage";
import { FormModal } from "../components/FormModal";
import { DepartmentField } from "../components/DepartmentSelect";
import { RoleSelect, PostSelect } from "../components/LookupSelect";
import { DictionaryTag } from "../components/DictionarySelect";
import { formatTime, PersonAvatar } from "../components/shared";
import { api, jsonBody } from "../lib/api";
import { exportCsv } from "../lib/export";
import { usePageState } from "../lib/workspace";
import { useAuth } from "../lib/auth";
import type { User } from "../types";

export const scopeNames: Record<string, string> = {
  SELF: "仅本人",
  DEPARTMENT: "本部门",
  DEPARTMENT_TREE: "本部门及下级",
  CUSTOM: "指定部门",
  ALL: "全部数据",
};
const passwordRules = [
  { required: true, message: "请输入密码" },
  {
    pattern: /^(?=.*[A-Za-z])(?=.*\d).{10,64}$/,
    message: "10–64 位，且同时包含字母和数字",
  },
];

/** 密码重置是独立动作，不随用户编辑表单提交；重置后后端会撤销目标账号全部会话。 */
function ResetPassword({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  return (
    <>
      <Tooltip title="重置密码">
        <Button
          type="text"
          aria-label="重置密码"
          icon={<KeyRound size={15} />}
          onClick={() => {
            form.resetFields();
            setOpen(true);
          }}
        />
      </Tooltip>
      <FormModal
        title={`重置 ${user.nickname} 的密码`}
        open={open}
        form={form}
        width={480}
        onCancel={() => setOpen(false)}
        okText="确认重置"
        onSubmit={async (value) => {
          await api(`/system/users/${user.id}/password`, {
            method: "PUT",
            body: jsonBody(value),
          });
          message.success("密码已重置，该用户需重新登录");
          setOpen(false);
        }}
      >
        <Alert
          type="warning"
          showIcon
          title="重置后将退出该账号的所有登录会话"
        />
        <Form.Item
          label="新密码"
          name="password"
          rules={passwordRules}
          style={{ marginTop: 20 }}
        >
          <Input.Password
            autoComplete="new-password"
            placeholder="设置新的登录密码"
          />
        </Form.Item>
      </FormModal>
    </>
  );
}

async function exportUsers(params: Record<string, unknown>) {
  return exportCsv<User>({
    endpoint: "/system/users/export",
    params,
    name: "Mayday-用户",
    headers: ["用户名", "姓名", "部门", "角色", "邮箱", "电话", "状态"],
    row: (user) => [
      user.username,
      user.nickname,
      user.departmentName,
      user.roleNames.join("、"),
      user.email,
      user.phone,
      user.enabled ? "启用" : "停用",
    ],
  });
}
export function UsersPage() {
  const { can, session } = useAuth();
  const [departmentId, setDepartmentId] = usePageState<number | undefined>(
    "users.department",
    undefined,
  );
  const emailRead = can("users:sensitive") || can("users:email-read");
  const emailWrite = can("users:sensitive") || can("users:email-write");
  const phoneRead = can("users:sensitive") || can("users:phone-read");
  const phoneWrite = can("users:sensitive") || can("users:phone-write");
  const isSelf = (u: User) => u.id === session?.user.id;
  return (
    <ResourcePage<User>
      resource="users"
      endpoint="/system/users"
      queryParams={{ departmentId }}
      savedFilters={{
        keys: ["departmentId"],
        apply: (values) =>
          setDepartmentId(
            typeof values.departmentId === "number" && values.departmentId > 0
              ? values.departmentId
              : undefined,
          ),
      }}
      hasExtraFilters={departmentId !== undefined}
      onResetFilters={() => setDepartmentId(undefined)}
      extraFilters={
        <div style={{ width: 180 }}>
          <DepartmentField value={departmentId} onChange={setDepartmentId} />
        </div>
      }
      title="用户管理"
      singular="用户"
      statusField="enabled"
      defaults={{ roleIds: [] }}
      exportRows={exportUsers}
      canSelect={(user) => user.username !== "admin" && !isSelf(user)}
      batchActions={[true, false].map((enabled) => ({
        key: String(enabled),
        label: enabled ? "批量启用" : "批量停用",
        permission: "users:update",
        danger: !enabled,
        run: async (rows) => {
          await api("/system/users/status", {
            method: "PUT",
            body: jsonBody({
              enabled,
              rows: rows.map((row) => ({ id: row.id, version: row.version })),
            }),
          });
        },
      }))}
      createAllowed={session?.dataScopes.users === "ALL"}
      canDelete={(u) => u.username !== "admin" && !isSelf(u)}
      extraActions={(u) =>
        can("users:reset") ? <ResetPassword user={u} /> : null
      }
      columns={[
        {
          title: "成员",
          key: "user",
          width: 220,
          render: (_, u) => (
            <div className="person-cell">
              <PersonAvatar name={u.nickname} />
              <div>
                <strong>
                  {u.nickname}
                  {isSelf(u) && <span className="you-label">你</span>}
                </strong>
                <small>@{u.username}</small>
              </div>
            </div>
          ),
        },
        { title: "所属部门", dataIndex: "departmentName", width: 150 },
        {
          title: "角色",
          dataIndex: "roleNames",
          width: 190,
          render: (names: string[]) => (
            <div className="tag-wrap">
              {names.length ? (
                names.map((n) => (
                  <Tag
                    key={n}
                    color={n === "超级管理员" ? "purple" : "default"}
                  >
                    {n}
                  </Tag>
                ))
              ) : (
                <span className="muted">未分配角色</span>
              )}
            </div>
          ),
        },
        ...(emailRead
          ? [
              {
                title: "联系邮箱",
                dataIndex: "email",
                width: 220,
                render: (email: string) => (
                  <span className="muted">{email || "—"}</span>
                ),
              },
            ]
          : []),
        {
          title: "状态",
          dataIndex: "enabled",
          width: 100,
          render: (enabled: boolean) => (
            <DictionaryTag
              code="user.status"
              value={String(enabled)}
              fallback={enabled ? "启用" : "停用"}
            />
          ),
        },
        {
          title: "加入时间",
          dataIndex: "createdAt",
          width: 170,
          render: formatTime,
        },
      ]}
      beforeSave={(values, record) => ({
        ...values,
        username: record?.username ?? values.username,
        roleIds:
          can("users:assign") && (!record || !isSelf(record))
            ? (values.roleIds ?? [])
            : (record?.roleIds ?? []),
        departmentId: session?.admin
          ? (values.departmentId ?? null)
          : (record?.departmentId ?? null),
      })}
      fields={(record) => (
        <>
          <div className="form-section-title">基本信息</div>
          <div className="form-two-columns">
            <Form.Item
              label="用户名"
              name="username"
              rules={[
                { required: true },
                {
                  pattern: /^[A-Za-z0-9_]{3,32}$/,
                  message: "3–32 位字母、数字或下划线",
                },
              ]}
            >
              <Input
                placeholder="如 zhang_san"
                disabled={!!record}
                maxLength={32}
              />
            </Form.Item>
            <Form.Item
              label="姓名 / 昵称"
              name="nickname"
              rules={[{ required: true }]}
            >
              <Input placeholder="请输入姓名或昵称" maxLength={64} />
            </Form.Item>
          </div>
          {!record && (
            <Form.Item label="初始密码" name="password" rules={passwordRules}>
              <Input.Password
                autoComplete="new-password"
                placeholder="10–64 位，包含字母与数字"
              />
            </Form.Item>
          )}
          {emailRead && (
            <Form.Item
              label="邮箱"
              name="email"
              rules={[{ type: "email", message: "请输入有效邮箱" }]}
            >
              <Input
                placeholder="name@example.com"
                maxLength={128}
                disabled={!emailWrite}
              />
            </Form.Item>
          )}
          {phoneRead && (
            <Form.Item label="联系电话" name="phone">
              <Input
                placeholder="输入联系电话"
                maxLength={32}
                disabled={!phoneWrite}
              />
            </Form.Item>
          )}
          <div className="form-section-title">组织与权限</div>
          <Form.Item
            label="所属部门"
            name="departmentId"
            extra={!session?.admin ? "调整部门需要超级管理员权限" : undefined}
          >
            <DepartmentField disabled={!session?.admin} />
          </Form.Item>
          <Form.Item
            label="角色"
            name="roleIds"
            extra="多个角色的操作权限取并集"
          >
            <RoleSelect
              mode="multiple"
              placeholder="选择角色"
              disabled={!can("users:assign") || (!!record && isSelf(record))}
            />
          </Form.Item>
          <Form.Item label="岗位" name="postIds">
            <PostSelect mode="multiple" allowClear placeholder="请选择岗位" />
          </Form.Item>
          <Form.Item label="账号状态" name="enabled" valuePropName="checked">
            <Switch
              checkedChildren="启用"
              unCheckedChildren="停用"
              disabled={
                !!record && (record.username === "admin" || isSelf(record))
              }
            />
          </Form.Item>
        </>
      )}
    />
  );
}
