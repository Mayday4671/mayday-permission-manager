import { DataTable } from "../../components/DataTable";
import { useState } from "react";
import { App, Button, Form, Input, Select, Switch, Tag } from "antd";
import { Copy, Eye, Pencil, Plus, Send, Workflow } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourcePage } from "../../components/ResourcePage";
import { FormModal } from "../../components/FormModal";
import { DetailsModal } from "../../components/DetailsModal";
import { RemoteSelect } from "../../components/LookupSelect";
import { QueryState, formatTime } from "../../components/shared";
import { useAuth } from "../../lib/auth";
import { api, jsonBody } from "../../lib/api";
import {
  initialSpec,
  type WorkflowDefinition,
  type WorkflowSpec,
} from "../../types/workflow";
interface Version {
  id: number;
  versionNumber: number;
  publishedAt: string;
  publisherName: string;
  schema: WorkflowSpec;
}
interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  schema: WorkflowSpec;
}
interface WorkflowDraft {
  name: string;
  code: string;
  categoryId: number;
  businessType: WorkflowDefinition["businessType"];
  description?: string;
  enabled: boolean;
}
/** 流程列表负责启停和版本入口；设计器独立标签页，新增/修改基础资料使用统一弹窗。 */
export function WorkflowsPage() {
  const { can } = useAuth(),
    { message } = App.useApp(),
    client = useQueryClient(),
    navigate = useNavigate();
  const [form] = Form.useForm<WorkflowDraft>();
  const [editing, setEditing] = useState<WorkflowDefinition | null>(null),
    [copying, setCopying] = useState<WorkflowDefinition | null>(null),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<number | null>(null);
  const [templateKey, setTemplateKey] = useState<string | undefined>();
  const templates = useQuery({
    queryKey: ["workflows", "templates"],
    queryFn: () => api<WorkflowTemplate[]>("/operations/workflows/templates"),
    enabled: open && !editing && !copying,
    staleTime: 60000,
  });
  const history = useQuery({
    queryKey: ["workflows", "versions", selected],
    queryFn: () => api<Version[]>(`/operations/workflows/${selected}/versions`),
    enabled: selected !== null,
  });
  const show = (row: WorkflowDefinition | null, copy = false) => {
    setTemplateKey(undefined);
    setEditing(copy ? null : row);
    setCopying(copy ? row : null);
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            ...row,
            name: row.name + (copy ? " 副本" : ""),
            code: copy ? undefined : row.code,
          }
        : { businessType: "GENERAL", enabled: true },
    );
    setOpen(true);
  };
  return (
    <>
      <ResourcePage<WorkflowDefinition>
        resource="workflows"
        endpoint="/operations/workflows"
        title="流程定义"
        singular="流程"
        statusField="enabled"
        createAllowed={false}
        canEdit={() => false}
        canDelete={(r) => !r.publishedVersionId}
        fields={() => null}
        actionsWidth={200}
        extraToolbar={
          can("workflows:create") && (
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => show(null)}
            >
              新建流程
            </Button>
          )
        }
        columns={[
          { title: "流程名称", dataIndex: "name", width: 240 },
          { title: "分类", dataIndex: "category", width: 120 },
          {
            title: "业务类型",
            dataIndex: "businessType",
            width: 120,
            render: (v) => (v === "CONTENT" ? "内容发布审核" : "通用审批"),
          },
          {
            title: "发布版本",
            dataIndex: "publishedVersion",
            width: 110,
            render: (v) => (v ? "版本 " + v : "未发布"),
          },
          {
            title: "状态",
            dataIndex: "enabled",
            width: 95,
            render: (v) => (
              <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>
            ),
          },
          {
            title: "更新时间",
            dataIndex: "updatedAt",
            width: 170,
            render: formatTime,
          },
        ]}
        rowActions={(row) => [
          {
            key: "designer",
            label: "设计",
            icon: <Workflow size={16} />,
            onClick: () => navigate("/admin/workflow-designer?id=" + row.id),
          },
          {
            key: "edit",
            label: "编辑",
            icon: <Pencil size={16} />,
            hidden: !can("workflows:update"),
            onClick: () => show(row),
          },
          {
            key: "copy",
            label: "复制流程",
            icon: <Copy size={16} />,
            hidden: !can("workflows:create"),
            onClick: () => show(row, true),
          },
          {
            key: "history",
            label: "发布版本记录",
            icon: <Eye size={16} />,
            onClick: () => setSelected(row.id),
          },
          {
            key: "publish",
            label: "发布流程",
            icon: <Send size={16} />,
            hidden: !can("workflows:publish"),
            confirm: {
              title: "发布当前流程草稿？",
              description: "发布后新申请使用新版本，已有申请继续使用原版本。",
            },
            onClick: async () => {
              await api(`/operations/workflows/${row.id}/publish`, {
                method: "POST",
                body: jsonBody({ version: row.version }),
              });
              void client.invalidateQueries();
              message.success("流程已发布");
            },
          },
        ]}
      />
      <FormModal
        title={copying ? "复制流程" : editing ? "编辑流程信息" : "新建流程"}
        open={open}
        form={form}
        onCancel={() => setOpen(false)}
        onSubmit={async (values) => {
          const record = await api<WorkflowDefinition>(
            `/operations/workflows${editing ? "/" + editing.id : ""}`,
            {
              method: editing ? "PUT" : "POST",
              body: jsonBody({
                ...values,
                schema:
                  editing?.schema ??
                  copying?.schema ??
                  templates.data?.find(
                    (template) => template.key === templateKey,
                  )?.schema ??
                  initialSpec(),
                version: editing?.version,
              }),
            },
          );
          setOpen(false);
          void client.invalidateQueries();
          message.success("流程草稿已保存");
          if (!editing) navigate("/admin/workflow-designer?id=" + record.id);
        }}
      >
        {open && (
          <>
            {!editing && !copying && (
              <Form.Item
                label="常用模板"
                extra={
                  templates.data?.find(
                    (template) => template.key === templateKey,
                  )?.description ??
                  "可选择模板创建草稿，审批人和发布仍由你确认。"
                }
              >
                <Select
                  allowClear
                  loading={templates.isLoading}
                  value={templateKey}
                  status={templates.isError ? "error" : undefined}
                  placeholder="从空白流程开始"
                  options={templates.data?.map((template) => ({
                    value: template.key,
                    label: template.name,
                  }))}
                  onChange={(key) => {
                    setTemplateKey(key);
                    const template = templates.data?.find(
                      (item) => item.key === key,
                    );
                    if (template)
                      form.setFieldsValue({
                        name: template.name,
                        description: template.description,
                        businessType: "GENERAL",
                      });
                  }}
                />
              </Form.Item>
            )}
            <Form.Item
              name="name"
              label="流程名称"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item
              name="code"
              label="流程编码"
              rules={[
                { required: true },
                {
                  pattern: /^[A-Za-z0-9_-]{2,64}$/,
                  message: "使用 2–64 位字母、数字、下划线或横线",
                },
              ]}
            >
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item
              name="categoryId"
              label="审批分类"
              rules={[{ required: true }]}
            >
              <RemoteSelect
                kind="approvalcategories"
                initialOptions={
                  editing || copying
                    ? [
                        {
                          value: (editing ?? copying)!.categoryId,
                          label: (editing ?? copying)!.category,
                        },
                      ]
                    : []
                }
              />
            </Form.Item>
            <Form.Item
              name="businessType"
              label="业务类型"
              rules={[{ required: true }]}
            >
              <Select
                disabled={!!editing?.publishedVersionId}
                options={[
                  { value: "GENERAL", label: "通用审批" },
                  { value: "CONTENT", label: "内容发布审核" },
                ]}
              />
            </Form.Item>
            <Form.Item name="description" label="说明">
              <Input.TextArea rows={3} maxLength={500} />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}
      </FormModal>
      <DetailsModal
        title="流程发布版本"
        open={selected !== null}
        onClose={() => setSelected(null)}
        width={850}
      >
        <QueryState
          loading={history.isLoading}
          error={history.error}
          retry={() => void history.refetch()}
        >
          <DataTable
            rowKey="id"
            dataSource={history.data}
            pagination={{ pageSize: 8 }}
            columns={[
              { title: "版本", dataIndex: "versionNumber" },
              { title: "发布人", dataIndex: "publisherName" },
              {
                title: "发布时间",
                dataIndex: "publishedAt",
                render: formatTime,
              },
              { title: "表单字段", render: (_, r) => r.schema.fields.length },
              { title: "流程节点", render: (_, r) => r.schema.nodes.length },
            ]}
          />
        </QueryState>
      </DetailsModal>
    </>
  );
}
