import type { ReactNode } from "react";
import { Form, Modal, type FormInstance } from "antd";
import { useFormDialog } from "../lib/useFormDialog";

interface FormModalProps<T extends object> {
  title: string;
  open: boolean;
  form: FormInstance<T>;
  children: ReactNode;
  width?: number;
  zIndex?: number;
  okText?: string;
  /** 仅预览、模拟等不产生业务写入的弹窗可以关闭丢弃提醒。 */
  confirmDiscard?: boolean;
  onCancel: () => void;
  onSubmit: (values: T) => Promise<void>;
  /** 分页签表单在校验失败时先切到错误所在页签，再交给 Form 定位字段。 */
  onInvalid?: (field: (string | number)[]) => void;
}

/**
 * 业务操作统一使用居中弹窗：标题和按钮固定，只有表单内容在超出屏幕时滚动。
 * Form 负责校验，onSubmit 只接收校验通过的数据；请求失败保留输入，成功关闭由调用方决定。
 * forceRender 让外部表单实例在首次打开前就连接，支持列表先 resetFields / setFieldsValue。
 * 关闭动画结束后清空表单，避免密码或上一次编辑内容留在下一次操作中。
 */
export function FormModal<T extends object>({
  title,
  open,
  form,
  children,
  width = 640,
  zIndex,
  okText = "保存",
  confirmDiscard = true,
  onCancel,
  onSubmit,
  onInvalid,
}: FormModalProps<T>) {
  const { formName, saving, submit, close, reset, valuesChanged } =
    useFormDialog({
      open,
      form,
      confirmDiscard,
      zIndex,
      onCancel,
      onSubmit,
    });

  return (
    <Modal
      title={title}
      open={open}
      centered
      forceRender
      width={width}
      zIndex={zIndex}
      rootClassName="business-form-modal"
      classNames={{
        container: "form-modal-container",
        header: "form-modal-header",
        body: "form-modal-body",
        footer: "form-modal-footer",
      }}
      style={{ maxWidth: "calc(100vw - 32px)", paddingBottom: 0 }}
      mask={{ closable: false }}
      keyboard={!saving}
      closable={{ disabled: saving }}
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
      okText={okText}
      cancelText="取消"
      onCancel={() => void close()}
      onOk={() => form.submit()}
      afterClose={reset}
    >
      <Form
        name={formName}
        form={form}
        layout="vertical"
        disabled={saving}
        scrollToFirstError={{ block: "center", focus: true }}
        onFinish={(values) => void submit(values)}
        onFinishFailed={({ errorFields }) => {
          const field = errorFields[0]?.name;
          if (!field || !onInvalid) return;
          onInvalid(field);
          // 等错误所属页签显示后再聚焦，避免 Form 首次定位隐藏字段失败。
          requestAnimationFrame(() =>
            form.scrollToField(field, { block: "center", focus: true }),
          );
        }}
        onValuesChange={valuesChanged}
      >
        {children}
      </Form>
    </Modal>
  );
}
