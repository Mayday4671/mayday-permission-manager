import type { ReactNode } from "react";
import { Button, Drawer, Form, Space, type FormInstance } from "antd";
import { useFormDialog } from "../lib/useFormDialog";

interface FormDrawerProps<T extends object> {
  title: string;
  open: boolean;
  form: FormInstance<T>;
  children: ReactNode;
  confirmDiscard?: boolean;
  onCancel: () => void;
  onSubmit: (values: T) => Promise<void>;
}

/**
 * 外观配置使用右侧抽屉，保留页面上下文；标题/按钮固定，只有超高的内容区域滚动。
 * 桌面宽 480px，小屏使用可用宽度。复用弹窗的提交与离开保护，不改变业务表单容器。
 */
export function FormDrawer<T extends object>(props: FormDrawerProps<T>) {
  const { title, open, form, children } = props;
  const { formName, saving, submit, close, reset, valuesChanged } =
    useFormDialog({
      ...props,
      zIndex: 1200,
    });
  return (
    <Drawer
      title={title}
      open={open}
      placement="right"
      size="min(480px, 100vw)"
      forceRender
      zIndex={1200}
      rootClassName="theme-settings-drawer"
      keyboard={!saving}
      closable={{ disabled: saving }}
      mask={{ closable: !saving }}
      onClose={() => void close()}
      afterOpenChange={(visible) => {
        if (!visible) reset();
      }}
      footer={
        <Space>
          <Button disabled={saving} onClick={() => void close()}>
            取消
          </Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form
        name={formName}
        form={form}
        layout="vertical"
        disabled={saving}
        scrollToFirstError={{ block: "center", focus: true }}
        onFinish={(values) => void submit(values)}
        onValuesChange={valuesChanged}
      >
        {/* 原生主题选项也需要锁定；Form.disabled 只覆盖接入 Ant 上下文的组件。 */}
        <fieldset className="form-drawer-fields" disabled={saving}>
          {children}
        </fieldset>
      </Form>
    </Drawer>
  );
}
