import { Button, Modal } from "antd";
import type { ReactNode } from "react";
/** 只读详情沿用业务弹窗的固定标题、滚动正文和窄屏尺寸，不复用编辑表单状态。 */
export function DetailsModal({
  title,
  open,
  onClose,
  children,
  width = 720,
  zIndex,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  zIndex?: number;
}) {
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      centered
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
      footer={<Button onClick={onClose}>关闭</Button>}
      destroyOnHidden
    >
      {children}
    </Modal>
  );
}
