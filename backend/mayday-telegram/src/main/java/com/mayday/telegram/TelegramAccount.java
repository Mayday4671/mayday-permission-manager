package com.mayday.telegram;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 单一 Telegram 用户账号的归属与可恢复状态。
 *
 * <p>
 * TDLib 会话主体文件保存在受控文件系统，不写入数据库；本表只保存所有者、脱敏手机号、TDLib 用户 ID 和状态摘要。
 */
@Getter
@Setter
@Table(value = "biz_telegram_account", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramAccount extends BaseEntity
{
    /** 固定槽位标识；首版只有 primary 一行，数据库唯一索引负责跨实例互斥。 */
    private String accountSlot;

    /** 创建并授权此账号的 Mayday 用户；后续操作按所有者或独立全量权限校验。 */
    private Long ownerId;

    /**
     * Department captured with the owner so role-based scope can view the shared
     * account safely.
     */
    private Long departmentId;

    /** 从授权请求生成的脱敏号码，仅用于界面识别账号，不可用于重新登录。 */
    private String maskedPhoneNumber;

    /** TDLib 当前授权用户 ID；尚未完成授权时为空。 */
    private Long telegramUserId;

    /** 最后一次已确认的 TDLib 授权状态；运行时连接状态另由生命周期服务维护。 */
    private String authorizationState;
}
