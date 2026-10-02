/**
 * 将分块 SSE 文本转换为完整事件。网络分块可能截断换行和 JSON，只有空行分隔后才交给消费方；
 * 忽略注释、未知字段及过大的事件，避免畸形响应不断累积占用内存。
 */
export function consumeSse(buffer: string): {
  remainder: string;
  events: { event: string; data: string }[];
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    if (block.length > 65536) return [];
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    return data.length ? [{ event, data: data.join("\n") }] : [];
  });
  return { remainder: remainder.length > 65536 ? "" : remainder, events };
}
