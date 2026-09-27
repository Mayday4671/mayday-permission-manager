import { useState } from "react";
import { Button, Checkbox, Empty, Input } from "antd";
import { Search } from "lucide-react";
import type { PermissionGroup } from "../types";
import { useAuth } from "../lib/auth";
import {
  changePermission,
  permissionDependencies,
} from "../lib/permission-selection";

/** 模块选择和权限编辑各占一栏，限制滚动区域；切换模块不卸载或重置表单的完整权限值。 */
export function PermissionPicker({
  value = [],
  onChange,
  groups,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  groups: PermissionGroup[];
}) {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const matches = groups.filter((group) =>
    `${group.name} ${group.key} ${Object.values(group.actions).join(" ")}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const active = matches.find((group) => group.key === selected) ?? matches[0];
  const editable = active
    ? Object.keys(active.actions)
        .map((action) => `${active.key}:${action}`)
        .filter((key) => permissionDependencies(key).every(can))
    : [];
  const selectedCount = (group: PermissionGroup) =>
    Object.keys(group.actions).filter((action) =>
      value.includes(`${group.key}:${action}`),
    ).length;
  const batch = (checked: boolean) =>
    onChange?.(
      editable.reduce(
        (next, key) => changePermission(next, key, checked, can),
        value,
      ),
    );
  return (
    <div className="permission-picker">
      <div className="permission-picker-toolbar">
        <Input
          aria-label="搜索权限模块"
          placeholder="搜索模块或操作"
          prefix={<Search size={15} />}
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="muted">已选 {value.length} 项权限</span>
      </div>
      <div className="permission-picker-body">
        <nav className="permission-module-list" aria-label="权限模块">
          {matches.map((group) => (
            <button
              type="button"
              key={group.key}
              aria-current={active?.key === group.key ? "true" : undefined}
              onClick={() => setSelected(group.key)}
            >
              <span>{group.name}</span>
              <small>
                {selectedCount(group)} / {Object.keys(group.actions).length}
              </small>
            </button>
          ))}
          {!matches.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="没有匹配的模块"
            />
          )}
        </nav>
        <section
          className="permission-module-detail"
          aria-label={active ? `${active.name}权限` : "权限选项"}
        >
          {active && (
            <>
              <div className="permission-module-heading">
                <strong>{active.name}</strong>
                <div>
                  <Button
                    type="link"
                    size="small"
                    disabled={!editable.length}
                    onClick={() => batch(true)}
                  >
                    全选本模块
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    disabled={!editable.some((key) => value.includes(key))}
                    onClick={() => batch(false)}
                  >
                    清空
                  </Button>
                </div>
              </div>
              <div className="permission-choice-grid">
                {Object.entries(active.actions)
                  .sort(([a], [b]) =>
                    a === "view" ? -1 : b === "view" ? 1 : 0,
                  )
                  .map(([action, label]) => {
                    const key = `${active.key}:${action}`;
                    return (
                      <Checkbox
                        key={key}
                        aria-label={`${active.name} - ${label}`}
                        checked={value.includes(key)}
                        disabled={!permissionDependencies(key).every(can)}
                        onChange={(event) =>
                          onChange?.(
                            changePermission(
                              value,
                              key,
                              event.target.checked,
                              can,
                            ),
                          )
                        }
                      >
                        {label}
                        {[
                          "grant",
                          "sensitive",
                          "assign",
                          "reset",
                          "publish",
                          "export",
                        ].includes(action) && <i className="permission-dot" />}
                      </Checkbox>
                    );
                  })}
              </div>
              <p className="permission-picker-help">
                <i className="permission-dot" />{" "}
                敏感操作；选择操作时自动关联必要的查看权限。
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
