import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Tag } from "antd";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  type Node,
  type NodeProps,
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowNode } from "../../types/workflow";

/** 图形展示的最小契约，与设计字段和运行人员信息隔离。 */
export interface DiagramNode {
  id: string;
  name: string;
  type: WorkflowNode["type"];
  next?: string;
  branches?: string[];
  current?: boolean;
  visited?: boolean;
  description?: string;
}
type CanvasNode = Node<
  {
    item: DiagramNode;
    onEdit?: (id: string) => void;
    onInsert?: (id: string) => void;
    start: boolean;
    horizontal: boolean;
  },
  "workflow"
>;
const labels = {
  APPROVAL: "审批",
  COPY: "抄送",
  CONDITION: "条件",
  PARALLEL: "并行",
  JOIN: "汇合",
  SUBPROCESS: "子流程",
  END: "结束",
};

/** 图节点只展示元信息；运行图不接受未来人员、隐藏表单值或条件比较内容。 */
function WorkflowCanvasNode({ data }: NodeProps<CanvasNode>) {
  const { item, onEdit, onInsert, start, horizontal } = data;
  const exits =
    item.type === "END"
      ? []
      : [
          ...(item.type === "PARALLEL" ? [] : ["default"]),
          ...(item.branches ?? []).map((_, index) => `branch:${index}`),
        ];
  return (
    <div
      className={`workflow-canvas-node ${item.current ? "current" : item.visited ? "visited" : ""}`}
    >
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
      />
      <div className="workflow-canvas-title">
        <strong>{item.name}</strong>
        <Tag>{labels[item.type]}</Tag>
      </div>
      {(item.type !== "END" || item.current || start) && (
        <div className="workflow-canvas-description">
          {item.current
            ? "当前办理"
            : start
              ? "流程起点"
              : (item.description ?? item.id)}
        </div>
      )}
      {onEdit && (
        <Button size="small" className="nodrag" onClick={() => onEdit(item.id)}>
          配置节点
        </Button>
      )}
      {onInsert && item.type !== "END" && (
        <Button
          size="small"
          type="link"
          className="nodrag"
          onClick={() => onInsert(item.id)}
        >
          后接节点
        </Button>
      )}
      {exits.map((id, index) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={horizontal ? Position.Right : Position.Bottom}
          style={{
            [horizontal ? "top" : "left"]:
              `${((index + 1) * 100) / (exits.length + 1)}%`,
          }}
        />
      ))}
    </div>
  );
}
const nodeTypes = { workflow: WorkflowCanvasNode };

/** 有界自动分层支持未完成草稿；图中的缺失出口保留给发布校验，循环不会拖死编辑器。 */
function layout(items: DiagramNode[], start: string, horizontal: boolean) {
  const levels = new Map<string, number>([[start, 0]]);
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (const item of items)
      if (levels.has(item.id)) {
        for (const next of [item.next, ...(item.branches ?? [])])
          if (
            next &&
            items.some((item) => item.id === next) &&
            (levels.get(next) ?? -1) < (levels.get(item.id) ?? 0) + 1
          ) {
            levels.set(next, (levels.get(item.id) ?? 0) + 1);
            changed = true;
          }
      }
    if (!changed) break;
  }
  // 默认链优先占主通道，条件分支另占一条通道；汇合节点保留首次位置，避免直线穿过被跳过节点。
  const lanes = new Map<string, number>();
  let lastLane = 0;
  const place = (id: string | undefined, lane: number) => {
    const item = items.find((item) => item.id === id);
    if (!item || lanes.has(item.id)) return;
    lanes.set(item.id, lane);
    place(item.next, lane);
    item.branches?.forEach((target) => place(target, ++lastLane));
  };
  place(start, 0);
  items.forEach((item) => {
    if (!lanes.has(item.id)) place(item.id, ++lastLane);
  });
  return items.map((item) => {
    const level = levels.get(item.id) ?? items.length;
    const lane = lanes.get(item.id) ?? 0;
    return {
      id: item.id,
      position: horizontal
        ? { x: level * 270, y: lane * 165 }
        : { x: lane * 250, y: level * 165 },
    };
  });
}

/** 设计器与运行详情共用连接图；拖动仅调整本次视图，连线明确修改指定默认/条件出口。 */
export function WorkflowDiagram({
  items,
  startNodeId,
  onEdit,
  onConnect,
  onInsert,
}: {
  items: DiagramNode[];
  startNodeId: string;
  onEdit?: (id: string) => void;
  onInsert?: (id: string) => void;
  onConnect?: (source: string, target: string, branch: number | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1280);
  const horizontal = containerWidth >= 640;
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    // 未选中的标签页面板宽度为 0，不将隐藏状态误当手机宽度；显示后再更新真实尺寸。
    const measure = () => {
      if (element.clientWidth > 0) setContainerWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const initial = useMemo(
    () =>
      layout(items, startNodeId, horizontal).map((position) => ({
        ...position,
        type: "workflow" as const,
        data: {
          item: items.find((item) => item.id === position.id)!,
          onEdit,
          onInsert,
          start: position.id === startNodeId,
          horizontal,
        },
      })),
    [items, startNodeId, onEdit, onInsert, horizontal],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial);
  useEffect(() => setNodes(initial), [initial, setNodes]);
  const edges = useMemo<Edge[]>(
    () =>
      items.flatMap((item) => {
        const exits = [
          ...(item.type === "PARALLEL"
            ? []
            : [
                {
                  target: item.next,
                  handle: "default",
                  label: item.type === "CONDITION" ? "默认" : "",
                },
              ]),
          ...(item.branches ?? []).map((target, index) => ({
            target,
            handle: `branch:${index}`,
            label: `分支${index + 1}`,
          })),
        ];
        return exits
          .filter(
            (exit) =>
              exit.target && items.some((node) => node.id === exit.target),
          )
          .map((exit) => ({
            id: `${item.id}:${exit.handle}`,
            source: item.id,
            target: exit.target!,
            sourceHandle: exit.handle,
            label: exit.label,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "var(--app-primary-text)", strokeWidth: 1.5 },
            labelStyle: { fill: "var(--app-text-secondary)" },
            labelBgStyle: { fill: "var(--app-surface)" },
          }));
      }),
    [items],
  );
  const connect = (connection: Connection) => {
    if (
      !connection.source ||
      !connection.target ||
      connection.source === connection.target
    )
      return;
    const handle = connection.sourceHandle;
    onConnect?.(
      connection.source,
      connection.target,
      handle?.startsWith("branch:") ? Number(handle.slice(7)) : null,
    );
  };
  return (
    <div ref={container} className="workflow-diagram" aria-label="流程连接图">
      <ReactFlow<CanvasNode>
        key={`${horizontal ? "wide" : containerWidth}:${items.length}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect ? connect : undefined}
        nodesConnectable={!!onConnect}
        edgesFocusable={false}
        nodesDraggable
        fitView={horizontal}
        defaultViewport={
          horizontal
            ? { x: 0, y: 0, zoom: 1 }
            : {
                x: (containerWidth - 220) / 2,
                y: 24,
                zoom: 1,
              }
        }
        fitViewOptions={{ padding: 0.08, minZoom: 0.6, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        deleteKeyCode={null}
        connectionLineStyle={{ stroke: "var(--app-primary-text)" }}
      >
        <Background color="var(--app-border-strong)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
