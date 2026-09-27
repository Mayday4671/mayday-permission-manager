import { useCallback, useState } from "react";
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Popconfirm,
  Popover,
  Tooltip,
} from "antd";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { FormModal } from "./FormModal";
import { useBrowserPreference } from "../lib/useBrowserPreference";
import {
  readSavedQueries,
  savedQueryLimit,
  type SavedQuery,
} from "../lib/list-preferences";

interface Props {
  namespace: string;
  keyword: string;
  status?: boolean;
  extra: Record<string, unknown>;
  allowedKeys: string[];
  onApply: (query: SavedQuery) => void;
}

/** 常用查询只在用户点击保存后保留筛选条件；读取数据仍走当前用户的真实鉴权接口。 */
export function SavedQueries({
  namespace,
  keyword,
  status,
  extra,
  allowedKeys,
  onApply,
}: Props) {
  const keyList = JSON.stringify(allowedKeys);
  const parse = useCallback(
    (raw: unknown) => readSavedQueries(raw, JSON.parse(keyList)),
    [keyList],
  );
  const [queries, setQueries] = useBrowserPreference(
    `${namespace}.savedQueries`,
    parse,
  );
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  const { message } = App.useApp();
  return (
    <>
      <Popover
        title="常用查询"
        trigger="click"
        placement="bottomRight"
        open={expanded}
        onOpenChange={setExpanded}
        content={
          <div className="saved-query-list">
            {queries.length ? (
              queries.map((query) => (
                <div className="saved-query-row" key={query.id}>
                  <Button
                    type="text"
                    title={query.name}
                    onClick={() => {
                      onApply(query);
                      setExpanded(false);
                    }}
                  >
                    {query.name}
                  </Button>
                  <Popconfirm
                    title={`删除“${query.name}”？`}
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() =>
                      setQueries((previous) =>
                        previous.filter((item) => item.id !== query.id),
                      )
                    }
                  >
                    <Button
                      type="text"
                      danger
                      aria-label={`删除查询 ${query.name}`}
                      icon={<Trash2 size={14} />}
                    />
                  </Popconfirm>
                </div>
              ))
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="尚未保存查询"
              />
            )}
            <Button
              block
              icon={<Plus size={14} />}
              disabled={queries.length >= savedQueryLimit}
              onClick={() => {
                setExpanded(false);
                form.resetFields();
                setSaving(true);
              }}
            >
              保存当前条件
              {queries.length >= savedQueryLimit
                ? `（最多 ${savedQueryLimit} 条）`
                : ""}
            </Button>
            <small className="muted">
              保存在本浏览器当前账号下，可随时删除。
            </small>
          </div>
        }
      >
        <Tooltip title="常用查询">
          <Button aria-label="常用查询" icon={<Bookmark size={16} />} />
        </Tooltip>
      </Popover>
      <FormModal
        title="保存常用查询"
        open={saving}
        form={form}
        width={420}
        onCancel={() => setSaving(false)}
        onSubmit={async ({ name }) => {
          const trimmed = name.trim();
          if (queries.length >= savedQueryLimit)
            throw new Error(
              `最多保存 ${savedQueryLimit} 条查询，请先删除不再使用的查询`,
            );
          if (queries.some((item) => item.name === trimmed))
            throw new Error("查询名称已存在，请换一个名称");
          const entry = parse([
            { id: crypto.randomUUID(), name: trimmed, keyword, status, extra },
          ])[0];
          const persisted = setQueries((previous) => [...previous, entry]);
          setSaving(false);
          if (persisted) message.success("已保存到常用查询");
          else message.warning("浏览器无法保存偏好，本次查询仅在当前页面有效");
        }}
      >
        <Form.Item
          name="name"
          label="查询名称"
          rules={[
            { required: true, whitespace: true, message: "请输入查询名称" },
            { max: 24 },
          ]}
        >
          <Input maxLength={24} placeholder="例如：停用账号、近期失败登录" />
        </Form.Item>
      </FormModal>
    </>
  );
}
