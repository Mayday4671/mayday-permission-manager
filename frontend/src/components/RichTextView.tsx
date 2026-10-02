import DOMPurify from "dompurify";

/** 与服务器一致的排版白名单。公开门户只加载阅读组件，不下载后台编辑器及其扩展。 */
export function cleanRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "blockquote",
    ],
    ALLOWED_ATTR: [],
  });
}
/** 正文展示只能使用清洗后的排版 HTML，不允许事件、外部嵌入和用户提供的元素属性。 */
export function RichTextView({ content }: { content: string }) {
  return (
    <div
      className="rich-text-content"
      dangerouslySetInnerHTML={{ __html: cleanRichText(content) }}
    />
  );
}
