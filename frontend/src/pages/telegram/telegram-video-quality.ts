import { formatTelegramFileSize } from "./telegram-file-size";
import type { TelegramVideoQuality } from "./telegram-media-types";

export interface VideoDimensions {
  width: number;
  height: number;
}

/** 画质依据源尺寸；播放器读到实际尺寸后优先使用，不根据搜索词推断或补造清晰度。 */
export function videoResolution(dimensions: VideoDimensions): string {
  const { width, height } = dimensions;
  return Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? `${Math.min(width, height)}p`
    : "分辨率未知";
}

/** 源文件不等于高画质；同分辨率的备用编码保留独立选项和大小，便于用户辨别。 */
export function videoQualityOptions(
  qualities: TelegramVideoQuality[],
  measured: Record<string, VideoDimensions>,
) {
  return qualities.map((quality) => {
    const dimensions = measured[quality.id] ?? quality;
    const resolution = videoResolution(dimensions);
    const codec = quality.codec ? ` · ${quality.codec.toUpperCase()}` : "";
    return {
      value: quality.id,
      label:
        quality.id === "original"
          ? `源文件 · ${resolution}`
          : `${resolution}${codec}`,
      description: [
        resolution === "分辨率未知"
          ? ""
          : `${dimensions.width} × ${dimensions.height}`,
        formatTelegramFileSize(quality.size),
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}
