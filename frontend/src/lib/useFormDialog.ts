import { useEffect, useId, useRef, useState } from "react";
import { App, Form, type FormInstance } from "antd";
import { useUnsavedChanges } from "./useUnsavedChanges";

interface FormDialogOptions<T extends object> {
  open: boolean;
  form: FormInstance<T>;
  confirmDiscard?: boolean;
  zIndex?: number;
  onCancel: () => void;
  onSubmit: (values: T) => Promise<void>;
}

/**
 * 弹窗和抽屉共用表单生命周期：程序改值也参与离开保护，失败保留草稿，提交使用同步锁。
 * 展示容器负责动画；只有动画关闭完成后调用 reset，避免在关闭过程中闪回空白表单。
 */
export function useFormDialog<T extends object>({
  open,
  form,
  confirmDiscard = true,
  zIndex,
  onCancel,
  onSubmit,
}: FormDialogOptions<T>) {
  const { message } = App.useApp();
  // 同页多个表单使用独立 ID 前缀，保证 label 关联和错误焦点跳转准确。
  const formName = useId();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const original = useRef("");
  const submitting = useRef(false);
  const watched = Form.useWatch((values) => values, { form, preserve: true });
  useEffect(() => {
    if (open) {
      // 调用者在打开前提供初值；本次打开仅取一次快照，后台刷新不能覆盖编辑草稿。
      original.current = JSON.stringify(form.getFieldsValue(true));
      setDirty(false);
    }
  }, [open, form]);
  // 同时观察用户输入与 setFieldValue，恢复默认或导入配置也属于未保存修改。
  useEffect(() => {
    if (open)
      setDirty(JSON.stringify(form.getFieldsValue(true)) !== original.current);
  }, [open, watched, form]);
  const confirmLeave = useUnsavedChanges(open && dirty && confirmDiscard, {
    busy: open && saving,
    zIndex: zIndex === undefined ? undefined : zIndex + 20,
  });
  const submit = async (values: T) => {
    // 同步 ref 覆盖快速连点及 Enter 与保存按钮同时提交的间隙。
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "保存失败，请重试",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return {
    formName,
    saving,
    submit,
    close: async () => {
      if (!submitting.current && (await confirmLeave())) onCancel();
    },
    reset: () => {
      form.resetFields();
      setDirty(false);
    },
    valuesChanged: () =>
      setDirty(JSON.stringify(form.getFieldsValue(true)) !== original.current),
  };
}
