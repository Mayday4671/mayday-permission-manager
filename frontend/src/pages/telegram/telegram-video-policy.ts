import type { TelegramCollectedMedia } from "./telegram-media-types";

const VIDEO_KINDS = new Set(["VIDEO", "ANIMATION", "DOCUMENT"]);
const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/x-matroska",
  "video/quicktime",
]);
const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|webm|mkv|mov)$/i;

/** Preview hints mirror the server policy; the server validates the actual file before conversion. */
export function telegramVideoPreviewMode(
  attachment: TelegramCollectedMedia,
): "native" | "conversion" | null {
  if (!VIDEO_KINDS.has(attachment.kind)) return null;
  // Remote preview is opt-in server state; the stream validates binary headers before serving it.
  if (attachment.status === "REMOTE") {
    const fileName = attachment.fileName ?? "";
    if (/\.(?:mkv|mov)$/i.test(fileName)) return "conversion";
    return attachment.kind !== "DOCUMENT" ||
      /\.(?:mp4|m4v|webm)$/i.test(fileName)
      ? "native"
      : null;
  }
  const type = (attachment.mediaType ?? "").trim().toLowerCase();
  const supported =
    VIDEO_TYPES.has(type) ||
    ((!type || type === "application/octet-stream") &&
      VIDEO_EXTENSIONS.test(attachment.fileName ?? ""));
  if (!supported) return null;
  // Older stored files identify every EBML/ISO-BMFF header as WebM/MP4. A MOV/MKV
  // filename should offer conversion immediately instead of trying that broad MIME hint.
  if (/\.(?:mkv|mov)$/i.test(attachment.fileName ?? "")) return "conversion";
  // Stream tickets support detected MP4/WebM only. Other containers need FFprobe/FFmpeg first.
  return type === "video/mp4" || type === "video/webm"
    ? "native"
    : "conversion";
}
