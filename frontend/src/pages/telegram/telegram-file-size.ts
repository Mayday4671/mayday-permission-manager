import type { TelegramCollectedMedia } from "./telegram-media-types";

/** Telegram 未提供大小时不能显示为零；大视频按 GB/TB 展示，不依赖完整下载。 */
export function formatTelegramFileSize(
  bytes: number | null | undefined,
): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "大小未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))),
    units.length - 1,
  );
  return index === 0
    ? `${Math.round(bytes)} B`
    : `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

/** 已落盘文件取实际字节数，在线播放或待下载附件使用 Telegram 返回的源文件大小。 */
export function telegramMediaFileSize(
  media: Pick<TelegramCollectedMedia, "actualSize" | "expectedSize">,
): string {
  const actual = media.actualSize;
  return formatTelegramFileSize(
    actual != null && Number.isFinite(actual) && actual > 0
      ? actual
      : media.expectedSize,
  );
}
