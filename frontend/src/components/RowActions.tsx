import { App, Button, Dropdown, Tooltip } from "antd";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface RowAction {
  key: string;
  label: string;
  icon?: ReactNode;
  hidden?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  confirm?: { title: string; description: string };
  onClick: () => void | Promise<void>;
}

/** 通用行操作：常用动作使用文字，其余归入菜单；危险动作仍需明确确认，异步错误统一反馈。 */
export function RowActions({
  actions,
  label,
  visibleCount = 2,
}: {
  actions: RowAction[];
  label: string;
  visibleCount?: number;
}) {
  const { modal, message } = App.useApp();
  const visible = actions.filter((action) => !action.hidden);
  const run = async (action: RowAction) => {
    if (action.disabled) return;
    const execute = async () => {
      try {
        await action.onClick();
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : "操作失败，请重试",
        );
        throw error;
      }
    };
    if (action.confirm)
      modal.confirm({
        title: action.confirm.title,
        content: action.confirm.description,
        centered: true,
        okText: action.label,
        cancelText: "取消",
        okButtonProps: { danger: action.danger },
        onOk: execute,
      });
    else await execute().catch(() => {});
  };
  const overflow = visible.slice(visibleCount);
  return (
    <div className="row-actions">
      {visible.slice(0, visibleCount).map((action) => (
        <Tooltip key={action.key} title={action.disabledReason}>
          <Button
            type="link"
            danger={action.danger}
            disabled={action.disabled}
            aria-label={`${action.label}：${label}`}
            onClick={() => void run(action)}
          >
            {action.label}
          </Button>
        </Tooltip>
      ))}
      {overflow.length > 0 && (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: overflow.map((action) => ({
              key: action.key,
              label: (
                <span title={action.disabledReason}>
                  {action.label}
                  {action.disabledReason ? (
                    <small className="row-action-reason">
                      {action.disabledReason}
                    </small>
                  ) : null}
                </span>
              ),
              icon: action.icon,
              danger: action.danger,
              disabled: action.disabled,
              onClick: () => void run(action),
            })),
          }}
        >
          <Button
            type="link"
            aria-label={`更多操作：${label}`}
            aria-haspopup="menu"
          >
            更多
            <ChevronDown size={13} />
          </Button>
        </Dropdown>
      )}
    </div>
  );
}
