package com.mayday.telegram;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 持久化单个 Telegram 视频的点播预览状态。该实体只保存任务元数据和来源归属， 绝不保存 FFmpeg 命令、源文件路径、TDLib
 * 文件句柄或媒体正文。
 */
@Getter
@Setter
@Table(value = "biz_telegram_video_preview", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramVideoPreview extends BaseEntity
{
    /** 创建预览时的资源所有者；播放前仍需复核其当前授权。 */
    private Long ownerId;

    /** 创建预览时捕获的部门范围，防止将来部门变更扩大历史数据可见范围。 */
    private Long departmentId;

    /** 已完成下载并经来源消息校验的视频附件。 */
    private Long mediaId;

    /** QUEUED、PROCESSING、READY、FAILED、CANCELLED 或 EXPIRED。 */
    private String status;

    /** FFprobe 检查到的源时长，单位为秒。 */
    private java.math.BigDecimal durationSeconds;

    /** FFprobe 检查到的视频编码名称，仅供诊断与决定是否转码。 */
    private String videoCodec;

    /** FFprobe 检查到的首条音轨编码；没有音轨时为空。 */
    private String audioCodec;

    /** 是否执行了兼容性转码；未完成时为空。 */
    private Boolean transcoded;

    /** 用户可见的脱敏状态说明，不保存外部进程的原始输出。 */
    private String failureMessage;

    /** 自动恢复处理次数，防止坏文件永久循环占用工作线程。 */
    private Integer attemptCount;

    /** QUEUED/PROCESSING 任务已在模块存储配额中占用的空间上限。 */
    private Long reservedBytes;

    /** 本次 FFmpeg 工作器的随机租约令牌，用于结果提交时防止旧任务写入。 */
    private String leaseOwner;

    /** 当前工作租约过期时刻。 */
    private java.time.LocalDateTime leaseExpiresAt;
}
