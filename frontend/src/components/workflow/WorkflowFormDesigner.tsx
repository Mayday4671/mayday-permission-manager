import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Tooltip,
} from "antd";
import {
  AlignLeft,
  CalendarDays,
  CheckSquare,
  CircleDot,
  Copy,
  GripVertical,
  Hash,
  ListPlus,
  Monitor,
  MoveDown,
  MoveUp,
  Paperclip,
  Redo2,
  Smartphone,
  Table2,
  TextCursorInput,
  Trash2,
  Undo2,
  Users,
  Wallet,
  Building2,
  Calculator,
} from "lucide-react";
import { WorkflowFields } from "../WorkflowFields";
import { WorkflowInput, WorkflowDateRange } from "./WorkflowInputs";
import { WorkflowFieldProperties } from "./WorkflowFieldProperties";
import {
  copyWorkflowField,
  insertWorkflowField,
  moveWorkflowField,
  removeWorkflowField,
  validateWorkflowFields,
  validateWorkflowFormReferences,
  validateWorkflowFormValues,
} from "../../lib/workflowForm";
import {
  fieldNames,
  type FieldType,
  type WorkflowField,
  type WorkflowSpec,
} from "../../types/workflow";

/** 控件目录只记录展示信息，不扩展 Java 发布契约；新增控件必须先有运行与校验支持。 */
const controlGroups: { title: string; types: FieldType[] }[] = [
  {
    title: "基础控件",
    types: [
      "TEXT",
      "TEXTAREA",
      "NUMBER",
      "MONEY",
      "DATE",
      "DATETIME",
      "DATE_RANGE",
    ],
  },
  { title: "选择控件", types: ["SINGLE", "MULTI", "USER", "DEPARTMENT"] },
  { title: "其他控件", types: ["DETAILS", "CALCULATED", "FILES"] },
];
const controlIcons = {
  TEXT: TextCursorInput,
  TEXTAREA: AlignLeft,
  NUMBER: Hash,
  MONEY: Wallet,
  CALCULATED: Calculator,
  DATE: CalendarDays,
  DATETIME: CalendarDays,
  DATE_RANGE: CalendarDays,
  SINGLE: CircleDot,
  MULTI: CheckSquare,
  USER: Users,
  DEPARTMENT: Building2,
  DETAILS: Table2,
  FILES: Paperclip,
};
type FormDrag =
  { kind: "control"; type: FieldType } | { kind: "field"; id: string };
interface WorkflowFormDesignerProps {
  spec: WorkflowSpec;
  editable: boolean;
  formName?: string;
  onChange: (spec: WorkflowSpec, historyKey?: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

/**
 * 编排态仅展示控件外观，不读取通讯录、不上传附件，也不记录试填值。
 * 真实填写态另用 WorkflowFields；避免设计者点击字段时误打开人员查询或业务上传。
 */
function DesignControl({ field }: { field: WorkflowField }) {
  if (field.type === "FILES")
    return <Button icon={<Paperclip size={14} />}>选择附件</Button>;
  if (field.type === "USER" || field.type === "DEPARTMENT")
    return (
      <Select
        placeholder={field.placeholder || `请选择${fieldNames[field.type]}`}
        options={[]}
      />
    );
  if (field.type === "DATE_RANGE") return <WorkflowDateRange />;
  if (field.type === "DETAILS")
    return (
      <div className="workflow-form-detail-sample">
        <div className="workflow-detail-cells">
          {field.columns?.map((column) => (
            <label key={column.id}>
              <span>
                {column.label}
                {column.required && <i className="required-mark"> *</i>}
              </span>
              <WorkflowInput field={column} />
            </label>
          ))}
        </div>
        <Button type="dashed" size="small">
          添加明细
        </Button>
      </div>
    );
  return (
    <WorkflowInput
      field={{
        ...field,
        placeholder:
          field.placeholder ||
          `${field.type === "SINGLE" || field.type === "MULTI" ? "请选择" : "请输入"}${field.label || fieldNames[field.type]}`,
      }}
    />
  );
}

/**
 * OA 表单采用控件库、编排画布、属性三栏。点击即添加，拖放精确插入，已有字段 ID 始终不变。
 * 所有操作只修改父级未保存草稿；窄屏用弹窗容纳控件和属性，避免三栏挤出全页横向滚动。
 */
export function WorkflowFormDesigner({
  spec,
  editable,
  formName = "申请表单",
  onChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: WorkflowFormDesignerProps) {
  const { message, modal } = App.useApp();
  const workspace = useRef<HTMLDivElement>(null);
  const drag = useRef<FormDrag | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    spec.fields[0]?.id ?? null,
  );
  const [search, setSearch] = useState("");
  const [view, setView] = useState("design");
  const [device, setDevice] = useState("desktop");
  const [narrow, setNarrow] = useState(false);
  const [availableHeight, setAvailableHeight] = useState<number>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [dropId, setDropId] = useState<string | null>(null);
  const [preview] = Form.useForm();
  const selected = spec.fields.find((field) => field.id === selectedId) ?? null;
  const errors = [
    ...validateWorkflowFields(spec.fields),
    ...validateWorkflowFormReferences(spec),
  ];
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => {
      // 隐藏标签页没有可用尺寸；保留上次高度，激活后由容器观察器重新测量。
      if (!element.clientWidth) return;
      setNarrow(element.clientWidth <= 900);
      // 手机页头会换行，不能用固定减数假设画布起点。预留页脚与底部间距，
      // 长表单只在画布内部滚动；极矮窗口仍保留最小可操作区域。
      const top = Math.max(
        0,
        element.getBoundingClientRect().top + window.scrollY,
      );
      setAvailableHeight(
        Math.max(240, Math.floor(window.innerHeight - top - 72)),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const designer = element.closest(".workflow-designer");
    if (designer) observer.observe(designer);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (selectedId && !spec.fields.some((field) => field.id === selectedId)) {
      setSelectedId(spec.fields[0]?.id ?? null);
      setPropertiesOpen(false);
    }
  }, [spec.fields, selectedId]);
  /** 父模型改变后清空之前试填值，不把旧控件的值留给另一个控件或带入流程定义。 */
  useEffect(() => {
    if (view === "preview") preview.resetFields();
  }, [spec.fields, preview, view]);
  const select = (id: string) => {
    setSelectedId(id);
    if (narrow) setPropertiesOpen(true);
  };
  const mutate = (operation: () => WorkflowSpec) => {
    if (!editable) return null;
    try {
      const next = operation();
      onChange(next);
      return next;
    } catch (error) {
      message.error((error as Error).message);
      return null;
    }
  };
  const add = (type: FieldType, index = spec.fields.length) => {
    const next = mutate(() => insertWorkflowField(spec, index, type));
    if (!next) return;
    setSelectedId(next.fields[index].id);
    setPaletteOpen(false);
    if (narrow) setPropertiesOpen(true);
  };
  const copy = (field: WorkflowField) => {
    const next = mutate(() => copyWorkflowField(spec, field.id));
    if (next)
      setSelectedId(
        next.fields[spec.fields.findIndex((item) => item.id === field.id) + 1]
          .id,
      );
  };
  const remove = (field: WorkflowField) => {
    if (!editable) return;
    // 删除前先验证条件引用，不能弹出成功提示后再留下无法发布的分支。
    try {
      removeWorkflowField(spec, field.id);
    } catch (error) {
      message.error((error as Error).message);
      return;
    }
    modal.confirm({
      title: `删除“${field.label}”？`,
      content:
        "删除后会清理草稿节点对该字段的读写设置，已发布版本和已提交申请不受影响。",
      centered: true,
      onOk: () => {
        mutate(() => removeWorkflowField(spec, field.id));
      },
    });
  };
  const move = (field: WorkflowField, offset: -1 | 1) => {
    const index = spec.fields.findIndex((item) => item.id === field.id);
    const target = index + offset;
    if (target < 0 || target >= spec.fields.length) return;
    const beforeId =
      offset < 0
        ? spec.fields[target].id
        : (spec.fields[target + 1]?.id ?? null);
    mutate(() => moveWorkflowField(spec, field.id, beforeId));
  };
  const edit = (field: WorkflowField) => {
    if (
      !editable ||
      !selected ||
      field.id !== selected.id ||
      field.type !== selected.type
    )
      return;
    // 损坏的旧草稿不能因重复标识同时改动多个字段；保留原数据，交由发布校验明确拒绝。
    if (spec.fields.filter((item) => item.id === field.id).length !== 1) {
      message.error("字段标识重复，请先修复流程模型");
      return;
    }
    onChange(
      {
        ...spec,
        fields: spec.fields.map((item) =>
          item.id === field.id ? field : item,
        ),
      },
      `field:${field.id}`,
    );
  };
  /** 仅接收当前组件发起的拖放；外部网页、文本或文件不能被解释成表单字段。 */
  const beginDrag = (event: DragEvent, value: FormDrag) => {
    if (!editable) {
      event.preventDefault();
      return;
    }
    drag.current = value;
    event.dataTransfer.effectAllowed =
      value.kind === "control" ? "copy" : "move";
    event.dataTransfer.setData(
      "application/x-mayday-workflow-field",
      JSON.stringify(value),
    );
  };
  const endDrag = () => {
    drag.current = null;
    setDropId(null);
  };
  const acceptDrop = (event: DragEvent, beforeId: string | null) => {
    if (!editable || !drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    const value = drag.current;
    endDrag();
    if (value.kind === "control") {
      const index = beforeId
        ? spec.fields.findIndex((field) => field.id === beforeId)
        : spec.fields.length;
      if (index >= 0) add(value.type, index);
    } else {
      mutate(() => moveWorkflowField(spec, value.id, beforeId));
      setSelectedId(value.id);
    }
  };
  const palette = (
    <div className="workflow-form-palette-content">
      <Input.Search
        aria-label="搜索控件"
        placeholder="搜索控件"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        allowClear
      />
      {controlGroups.map((group) => {
        const types = group.types.filter((type) =>
          fieldNames[type].includes(search.trim()),
        );
        if (!types.length) return null;
        return (
          <section key={group.title}>
            <h4>{group.title}</h4>
            <div className="workflow-form-control-grid">
              {types.map((type) => {
                const Icon = controlIcons[type];
                return (
                  <Button
                    key={type}
                    aria-label={`添加${fieldNames[type]}`}
                    disabled={!editable || spec.fields.length >= 40}
                    draggable={editable && spec.fields.length < 40}
                    onDragStart={(event) =>
                      beginDrag(event, { kind: "control", type })
                    }
                    onDragEnd={endDrag}
                    icon={<Icon size={16} />}
                    onClick={() => add(type)}
                  >
                    {fieldNames[type]}
                  </Button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!Object.values(fieldNames).some((label) =>
        label.includes(search.trim()),
      ) && <p className="muted">没有匹配的控件</p>}
    </div>
  );
  const properties = (
    <WorkflowFieldProperties
      fields={spec.fields}
      field={selected}
      editable={editable}
      onChange={edit}
    />
  );
  return (
    <div
      ref={workspace}
      className="workflow-form-builder"
      style={
        availableHeight === undefined ? undefined : { height: availableHeight }
      }
    >
      <div className="workflow-form-tools">
        <div className="workflow-form-tool-group">
          <Segmented
            aria-label="表单操作模式"
            value={view}
            onChange={(value) => setView(String(value))}
            options={[
              { label: "设计", value: "design" },
              { label: "填写预览", value: "preview" },
            ]}
          />
          {view === "design" && editable && (
            <>
              <Tooltip title="撤销">
                <Button
                  aria-label="撤销表单修改"
                  disabled={!canUndo}
                  onClick={onUndo}
                  icon={<Undo2 size={15} />}
                />
              </Tooltip>
              <Tooltip title="重做">
                <Button
                  aria-label="重做表单修改"
                  disabled={!canRedo}
                  onClick={onRedo}
                  icon={<Redo2 size={15} />}
                />
              </Tooltip>
              {narrow && (
                <Button
                  icon={<ListPlus size={15} />}
                  onClick={() => setPaletteOpen(true)}
                >
                  添加控件
                </Button>
              )}
            </>
          )}
        </div>
        <div className="workflow-form-tool-group">
          {errors.length > 0 && (
            <Tooltip title={errors[0].message}>
              <span className="workflow-form-error-count">
                {new Set(errors.map((error) => error.fieldId)).size} 项待完善
              </span>
            </Tooltip>
          )}
          <Segmented
            aria-label="表单预览尺寸"
            value={device}
            onChange={(value) => setDevice(String(value))}
            options={[
              {
                label: (
                  <span className="workflow-form-device-label">
                    <Monitor size={15} />
                    桌面
                  </span>
                ),
                value: "desktop",
              },
              {
                label: (
                  <span className="workflow-form-device-label">
                    <Smartphone size={15} />
                    手机
                  </span>
                ),
                value: "mobile",
              },
            ]}
          />
        </div>
      </div>
      <div
        className={`workflow-form-layout ${view === "preview" ? "is-preview" : ""} ${narrow ? "is-narrow" : ""}`}
      >
        {view === "design" && !narrow && (
          <aside className="workflow-form-palette" aria-label="表单控件库">
            <header>
              <b>控件</b>
              <span>{spec.fields.length} / 40</span>
            </header>
            {palette}
          </aside>
        )}
        <main
          className="workflow-form-stage"
          aria-label={view === "design" ? "表单编排画布" : "表单填写预览"}
        >
          <div
            className={`workflow-form-sheet ${device === "mobile" ? "is-mobile" : ""}`}
          >
            <div className="workflow-form-sheet-title">{formName}</div>
            {view === "preview" ? (
              <Form
                form={preview}
                layout="vertical"
                className="workflow-form-live-preview"
              >
                <WorkflowFields fields={spec.fields} preview />
                <div className="workflow-form-preview-actions">
                  <Button onClick={() => preview.resetFields()}>
                    清空填写
                  </Button>
                  <Button
                    type="primary"
                    onClick={async () => {
                      try {
                        await preview.validateFields();
                        // 与服务端规则对齐；Ant 的必填检查不足以判断日期区间和明细内部数据。
                        const issues = validateWorkflowFormValues(
                          spec.fields,
                          preview.getFieldValue("values") ?? {},
                        );
                        if (issues.length) {
                          const fieldErrors = new Map<string, string[]>();
                          for (const issue of issues) {
                            const current =
                              fieldErrors.get(issue.fieldId) ?? [];
                            current.push(issue.message);
                            fieldErrors.set(issue.fieldId, current);
                          }
                          preview.setFields(
                            [...fieldErrors].map(([fieldId, messages]) => ({
                              name: ["values", fieldId],
                              errors: messages,
                            })),
                          );
                          message.error(issues[0].message);
                          return;
                        }
                        message.success("填写检查通过，未提交业务数据");
                      } catch {
                        /* Ant 在字段旁展示校验错误，保留试填值。 */
                      }
                    }}
                  >
                    检查填写
                  </Button>
                </div>
              </Form>
            ) : (
              <div className="workflow-form-field-grid">
                {spec.fields.map((field, index) => {
                  const error = errors.find(
                    (item) => item.fieldId === field.id,
                  )?.message;
                  return (
                    <section
                      key={field.id}
                      data-field-id={field.id}
                      className={`workflow-form-field ${field.width === 12 ? "is-half" : ""} ${selectedId === field.id ? "is-selected" : ""} ${dropId === field.id ? "is-drop-target" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`配置${field.label || fieldNames[field.type]}`}
                      aria-pressed={selectedId === field.id}
                      onClick={() => select(field.id)}
                      draggable={editable}
                      onDragStart={(event) =>
                        beginDrag(event, { kind: "field", id: field.id })
                      }
                      onDragEnd={endDrag}
                      onDragOver={(event) => {
                        if (editable && drag.current) {
                          event.preventDefault();
                          event.stopPropagation();
                          setDropId(field.id);
                        }
                      }}
                      onDrop={(event) => acceptDrop(event, field.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (
                          event.altKey &&
                          (event.key === "ArrowUp" || event.key === "ArrowDown")
                        ) {
                          event.preventDefault();
                          if (editable)
                            move(field, event.key === "ArrowUp" ? -1 : 1);
                        } else if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          select(field.id);
                        }
                      }}
                    >
                      <div className="workflow-form-field-header">
                        <GripVertical
                          size={14}
                          className="workflow-form-drag-handle"
                        />
                        <b>
                          {field.required && (
                            <i className="required-mark">* </i>
                          )}
                          {field.label || "未命名字段"}
                        </b>
                        <span className="workflow-form-type-name">
                          {fieldNames[field.type]}
                        </span>
                      </div>
                      <div
                        className="workflow-form-design-control"
                        aria-hidden="true"
                        inert
                      >
                        <DesignControl field={field} />
                      </div>
                      {field.helpText && (
                        <div className="workflow-form-field-help">
                          {field.helpText}
                        </div>
                      )}
                      {error && (
                        <div className="workflow-form-field-error">{error}</div>
                      )}
                      {editable && (
                        <div
                          className="workflow-form-field-actions"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            type="text"
                            size="small"
                            aria-label={`上移${field.label}`}
                            disabled={index === 0}
                            onClick={() => move(field, -1)}
                            icon={<MoveUp size={14} />}
                          />
                          <Button
                            type="text"
                            size="small"
                            aria-label={`下移${field.label}`}
                            disabled={index === spec.fields.length - 1}
                            onClick={() => move(field, 1)}
                            icon={<MoveDown size={14} />}
                          />
                          <Button
                            type="text"
                            size="small"
                            aria-label={`复制${field.label}`}
                            disabled={spec.fields.length >= 40}
                            onClick={() => copy(field)}
                            icon={<Copy size={14} />}
                          />
                          <Button
                            type="text"
                            size="small"
                            danger
                            aria-label={`删除${field.label}`}
                            onClick={() => remove(field)}
                            icon={<Trash2 size={14} />}
                          />
                        </div>
                      )}
                    </section>
                  );
                })}
                <div
                  className={`workflow-form-drop-end ${dropId === "__end__" ? "is-drop-target" : ""}`}
                  onDragOver={(event) => {
                    if (editable && drag.current) {
                      event.preventDefault();
                      setDropId("__end__");
                    }
                  }}
                  onDrop={(event) => acceptDrop(event, null)}
                >
                  {spec.fields.length === 0
                    ? "从左侧点击或拖入控件"
                    : editable
                      ? "拖入控件，或拖动字段到此处"
                      : ""}
                </div>
              </div>
            )}
          </div>
        </main>
        {view === "design" && !narrow && (
          <aside className="workflow-form-properties" aria-label="字段属性">
            {properties}
          </aside>
        )}
      </div>
      <Modal
        title="添加控件"
        open={paletteOpen && editable}
        onCancel={() => setPaletteOpen(false)}
        footer={null}
        width={460}
        centered
        className="workflow-form-mobile-dialog"
      >
        {palette}
      </Modal>
      <Modal
        title={selected ? `${fieldNames[selected.type]}设置` : "控件属性"}
        open={propertiesOpen && narrow && view === "design"}
        onCancel={() => setPropertiesOpen(false)}
        footer={
          <Button type="primary" onClick={() => setPropertiesOpen(false)}>
            完成
          </Button>
        }
        width={460}
        centered
        className="workflow-form-mobile-dialog"
      >
        {properties}
      </Modal>
    </div>
  );
}
