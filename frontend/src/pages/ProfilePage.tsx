import { useRef, useState } from "react";
import { App, Button, Form, Input, Tag } from "antd";
import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PersonAvatar, SectionTitle } from "../components/shared";
import { api, jsonBody, tokenStore } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUnsavedChanges } from "../lib/useUnsavedChanges";

/** 自助资料只允许修改下列字段，角色和部门完全不进入提交对象。 */
interface ProfileDraft {
  nickname: string;
  email?: string | null;
  phone?: string | null;
}

/** 确认密码只用于前端一致性校验，服务端请求只携带当前密码和新密码。 */
interface PasswordDraft {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** 自助资料接口独立于用户管理，只提交昵称与联系方式，不能自行修改角色和组织归属。 */
export function ProfilePage() {
  const { session, refresh } = useAuth();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [profileForm] = Form.useForm<ProfileDraft>();
  const profileSubmitting = useRef(false);
  const passwordSubmitting = useRef(false);
  const navigate = useNavigate();
  const user = session!.user;
  // 保存成功后更新比较基线；失败保留输入与离开保护，不能把未保存修改当作已完成。
  const original = useRef(
    JSON.stringify({
      nickname: user.nickname,
      email: user.email,
      phone: user.phone,
    }),
  );
  useUnsavedChanges(profileDirty || passwordDirty, {
    busy: saving || changing,
  });
  return (
    <>
      <div className="profile-grid">
        <aside className="panel profile-card">
          <PersonAvatar name={user.nickname} size={80} />
          <h2>{user.nickname}</h2>
          <p>@{user.username}</p>
          <div>
            {user.roleNames.map((r) => (
              <Tag color="purple" key={r}>
                {r}
              </Tag>
            ))}
          </div>
          <div className="profile-meta">
            <span>
              <ShieldCheck size={16} />
              {user.departmentName}
            </span>
            <span>
              <Mail size={16} />
              {user.email || "尚未填写邮箱"}
            </span>
          </div>
        </aside>
        <div className="profile-forms">
          <section className="panel">
            <SectionTitle title="基本资料" />
            <Form<ProfileDraft>
              form={profileForm}
              layout="vertical"
              disabled={saving}
              initialValues={{
                nickname: user.nickname,
                email: user.email,
                phone: user.phone,
              }}
              onValuesChange={() =>
                setProfileDirty(
                  JSON.stringify(profileForm.getFieldsValue()) !==
                    original.current,
                )
              }
              onFinish={async (values) => {
                if (profileSubmitting.current) return;
                profileSubmitting.current = true;
                setSaving(true);
                try {
                  await api("/auth/profile", {
                    method: "PUT",
                    body: jsonBody(values),
                  });
                  original.current = JSON.stringify(
                    profileForm.getFieldsValue(),
                  );
                  setProfileDirty(false);
                  await refresh();
                  message.success("个人资料已更新");
                } catch (e) {
                  message.error((e as Error).message);
                } finally {
                  profileSubmitting.current = false;
                  setSaving(false);
                }
              }}
            >
              <Form.Item
                name="nickname"
                label="姓名 / 昵称"
                rules={[{ required: true }]}
              >
                <Input maxLength={64} />
              </Form.Item>
              <div className="form-two-columns">
                <Form.Item
                  name="email"
                  label="邮箱"
                  rules={[{ type: "email" }]}
                >
                  <Input maxLength={128} />
                </Form.Item>
                <Form.Item name="phone" label="联系电话">
                  <Input maxLength={32} />
                </Form.Item>
              </div>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存资料
              </Button>
            </Form>
          </section>
          <section className="panel">
            <SectionTitle title="账号安全" subtitle="修改密码后需要重新登录" />
            <Form<PasswordDraft>
              layout="vertical"
              disabled={changing}
              onValuesChange={(_, values) =>
                setPasswordDirty(Object.values(values).some(Boolean))
              }
              onFinish={async (values) => {
                if (passwordSubmitting.current) return;
                passwordSubmitting.current = true;
                setChanging(true);
                try {
                  await api("/auth/password", {
                    method: "PUT",
                    body: jsonBody({
                      oldPassword: values.oldPassword,
                      newPassword: values.newPassword,
                    }),
                  });
                  // 后端已撤销旧会话，当前标签页必须同步清空身份和缓存，禁止继续以旧令牌操作。
                  tokenStore.clear();
                  window.dispatchEvent(new Event("mayday:unauthorized"));
                  message.success("密码已更新，请重新登录");
                  navigate("/login");
                } catch (e) {
                  message.error((e as Error).message);
                } finally {
                  passwordSubmitting.current = false;
                  setChanging(false);
                }
              }}
            >
              <Form.Item
                name="oldPassword"
                label="当前密码"
                rules={[{ required: true }]}
              >
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <div className="form-two-columns">
                <Form.Item
                  name="newPassword"
                  label="新密码"
                  rules={[
                    { required: true },
                    {
                      pattern: /^(?=.*[A-Za-z])(?=.*\d).{10,64}$/,
                      message: "10–64 位，包含字母和数字",
                    },
                  ]}
                >
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item
                  name="confirmPassword"
                  label="确认新密码"
                  dependencies={["newPassword"]}
                  rules={[
                    { required: true },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        return value === getFieldValue("newPassword")
                          ? Promise.resolve()
                          : Promise.reject(new Error("两次密码输入不一致"));
                      },
                    }),
                  ]}
                >
                  <Input.Password autoComplete="new-password" />
                </Form.Item>
              </div>
              <Button
                htmlType="submit"
                loading={changing}
                icon={<LockKeyhole size={15} />}
              >
                更新密码
              </Button>
            </Form>
          </section>
        </div>
      </div>
    </>
  );
}
