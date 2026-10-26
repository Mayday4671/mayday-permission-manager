import { useEffect, useRef, useState, type Key } from "react";
import { Button, Empty, Input, Tree, Tooltip, type TreeDataNode } from "antd";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { PermissionGroup } from "../types";
import { useAuth } from "../lib/auth";
import {
  changePermission,
  permissionDependencies,
} from "../lib/permission-selection";

/** 按模块与操作展示勾选树；父节点批量授权仍经过权限依赖和当前操作者的授权范围校验。 */
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
  const [expanded, setExpanded] = useState<Key[]>([]);
  const scrollArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [search]);
  const groupKey = (group: PermissionGroup) => `module:${group.key}`;
  const keys = (group: PermissionGroup) =>
    Object.keys(group.actions).map((action) => `${group.key}:${action}`);
  const editable = (key: string) => permissionDependencies(key).every(can);
  const matchingGroups = (query: string) =>
    groups.filter((group) =>
      `${group.name} ${group.key} ${Object.values(group.actions).join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const matches = matchingGroups(search);
  const checked = [...value];
  const halfChecked: string[] = [];
  const data: TreeDataNode[] = matches.map((group) => {
    const actions = keys(group);
    const selected = actions.filter((key) => value.includes(key)).length;
    if (actions.length && selected === actions.length)
      checked.push(groupKey(group));
    else if (selected) halfChecked.push(groupKey(group));
    return {
      key: groupKey(group),
      disableCheckbox: !actions.some(editable),
      title: (
        <span className="permission-tree-module">
          <span>{group.name}</span>
          <small>
            {selected} / {actions.length}
          </small>
        </span>
      ),
      children: Object.entries(group.actions)
        .sort(([a], [b]) => (a === "view" ? -1 : b === "view" ? 1 : 0))
        .map(([action, label]) => {
          const key = `${group.key}:${action}`;
          return {
            key,
            disableCheckbox: !editable(key),
            title: (
              <span title={key}>
                {label}
                {[
                  "grant",
                  "sensitive",
                  "assign",
                  "reset",
                  "publish",
                  "export",
                ].includes(action) && (
                  <Tooltip title="敏感操作">
                    <i className="permission-dot" />
                  </Tooltip>
                )}
              </span>
            ),
          };
        }),
    };
  });
  const change = (key: Key, selected: boolean) => {
    const group = groups.find((item) => groupKey(item) === key);
    const actions = group ? keys(group).filter(editable) : [String(key)];
    onChange?.(
      actions.reduce(
        (next, action) => changePermission(next, action, selected, can),
        value,
      ),
    );
  };
  return (
    <div className="permission-picker">
      <div className="permission-picker-toolbar">
        <Input
          aria-label="搜索权限模块"
          placeholder="搜索模块或操作"
          prefix={<Search size={15} />}
          allowClear
          value={search}
          onChange={(event) => {
            const query = event.target.value;
            setSearch(query);
            setExpanded(
              query.trim() ? matchingGroups(query).map(groupKey) : [],
            );
          }}
        />
        <div className="permission-tree-tools">
          <span className="muted">已选 {value.length} 项</span>
          <Button
            type="text"
            size="small"
            onClick={() => setExpanded(matches.map(groupKey))}
          >
            展开全部
          </Button>
          <Button type="text" size="small" onClick={() => setExpanded([])}>
            收起全部
          </Button>
        </div>
      </div>
      <div className="permission-tree-body" ref={scrollArea}>
        {data.length ? (
          <Tree
            aria-label="操作权限树"
            checkable
            checkStrictly
            blockNode
            selectedKeys={[]}
            checkedKeys={{ checked, halfChecked }}
            expandedKeys={expanded}
            onExpand={(next) => setExpanded(next)}
            switcherIcon={({ expanded: open }) =>
              open ? <ChevronDown size={15} /> : <ChevronRight size={15} />
            }
            treeData={data}
            onCheck={(_, info) => change(info.node.key, info.checked)}
            onSelect={(_, info) => {
              const key = info.node.key;
              if (info.node.children?.length)
                setExpanded((previous) =>
                  previous.includes(key)
                    ? previous.filter((item) => item !== key)
                    : [...previous, key],
                );
              else if (!info.node.disableCheckbox)
                change(key, !value.includes(String(key)));
            }}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有匹配的权限"
          />
        )}
      </div>
    </div>
  );
}
