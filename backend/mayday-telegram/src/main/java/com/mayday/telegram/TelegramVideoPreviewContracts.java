package com.mayday.telegram;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import org.jspecify.annotations.Nullable;

/** 客户端可见的点播预览状态；不含源媒体存储键、临时路径或 FFmpeg 输出。 */
public final class TelegramVideoPreviewContracts
{
    private TelegramVideoPreviewContracts()
    {
    }

    /** HLS 任务状态与播放入口；READY 之前不会提供任何清单地址。 */
    public record PreviewView(Long id, Long mediaId, String status, String statusMessage,
            @Nullable BigDecimal durationSeconds, @Nullable String videoCodec, @Nullable String audioCodec,
            @Nullable Boolean transcoded, @Nullable String manifestUrl, LocalDateTime updatedAt) {
        /** 将服务端持久化状态映射为不含存储与文件系统细节的响应。 */
        static PreviewView from(TelegramVideoPreview task)
        {
            String manifestUrl = "READY".equals(task.getStatus())
                    ? "/api/telegram/media/" + task.getMediaId() + "/hls/index.m3u8"
                    : null;
            String message = switch (task.getStatus())
            {
                case "QUEUED" -> "等待视频预览工作器处理";
                case "PROCESSING" -> "正在检查并生成受权播放文件";
                case "READY" -> "视频预览已准备好";
                case "FAILED" -> task.getFailureMessage();
                case "CANCELLED" -> "视频预览任务已取消";
                case "EXPIRED" -> "预览文件已按留存策略清理";
                default -> "视频预览当前不可用";
            };
            return new PreviewView(task.getId(), task.getMediaId(), task.getStatus(), message,
                    task.getDurationSeconds(), task.getVideoCodec(), task.getAudioCodec(), task.getTranscoded(),
                    manifestUrl, task.getUpdatedAt());
        }
    }
}
