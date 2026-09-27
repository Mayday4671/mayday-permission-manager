import { useEffect, useRef } from "react";
import { Button, ConfigProvider, Space, Tooltip } from "antd";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cleanRichText } from "./RichTextView";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Quote,
  Undo2,
  Redo2,
  RemoveFormatting,
} from "lucide-react";

/**
 * 通知、审批说明与内容正文共用 HTML 编辑器。仅开放已支持的排版，不接入任何云端 AI 服务。
 * Form 的 value/onChange 是唯一数据源：外部重置不触发 onChange，避免弹窗初值被记为用户修改。
 * 这里只提供客户端纵深防护；调用方保存 HTML 时必须同时使用服务端白名单清理。
 */
export function RichTextEditor({
  value = "",
  onChange,
  disabled: explicitlyDisabled = false,
  id,
  maxLength = 50000,
}: {
  value?: string;
  onChange?: (html: string) => void;
  disabled?: boolean;
  id?: string;
  maxLength?: number;
}) {
  const disabled =
    explicitlyDisabled || ConfigProvider.useConfig().componentDisabled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
      }),
    ],
    content: cleanRichText(value),
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "正文编辑器",
        "aria-multiline": "true",
        ...(id ? { id } : {}),
      },
    },
    onUpdate: ({ editor: current }) =>
      onChangeRef.current?.(current.isEmpty ? "" : current.getHTML()),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold"),
      italic: e?.isActive("italic"),
      heading: e?.isActive("heading", { level: 2 }),
      list: e?.isActive("bulletList"),
      ordered: e?.isActive("orderedList"),
      quote: e?.isActive("blockquote"),
      length: e?.isEmpty ? 0 : (e?.getHTML().length ?? 0),
    }),
  });
  useEffect(() => {
    if (editor && value !== (editor.isEmpty ? "" : editor.getHTML()))
      editor.commands.setContent(cleanRichText(value), { emitUpdate: false });
  }, [editor, value]);
  useEffect(() => {
    // 切换可编辑状态不是用户输入，不能触发表单校验或“未保存修改”提示。
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  if (!editor) return null;
  const actions = [
    {
      name: "加粗",
      icon: Bold,
      active: state?.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "斜体",
      icon: Italic,
      active: state?.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "二级标题",
      icon: Heading2,
      active: state?.heading,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      name: "无序列表",
      icon: List,
      active: state?.list,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: "有序列表",
      icon: ListOrdered,
      active: state?.ordered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "引用",
      icon: Quote,
      active: state?.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "清除格式",
      icon: RemoveFormatting,
      run: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
    },
    {
      name: "撤销",
      icon: Undo2,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      name: "重做",
      icon: Redo2,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div className={`rich-text-editor ${disabled ? "is-disabled" : ""}`}>
      <Space
        wrap
        size={2}
        className="rich-text-toolbar"
        role="toolbar"
        aria-label="正文排版"
      >
        {actions.map((action) => (
          <Tooltip title={action.name} key={action.name}>
            <Button
              htmlType="button"
              type={action.active ? "primary" : "text"}
              size="small"
              aria-label={action.name}
              aria-pressed={!!action.active}
              disabled={disabled}
              icon={<action.icon size={16} />}
              onMouseDown={(event) => event.preventDefault()}
              onClick={action.run}
            />
          </Tooltip>
        ))}
      </Space>
      <EditorContent editor={editor} />
      <div
        className={`rich-text-count ${(state?.length ?? 0) > maxLength ? "over-limit" : ""}`}
      >
        {state?.length ?? 0} / {maxLength}（含格式）
      </div>
    </div>
  );
}
