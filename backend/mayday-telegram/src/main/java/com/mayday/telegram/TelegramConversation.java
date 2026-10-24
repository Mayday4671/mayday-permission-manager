package com.mayday.telegram;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * Owner-scoped Mayday transcript grouping for several Telegram search turns.
 *
 * <p>
 * Telegram still receives each deliberate keyword in the same verified bot
 * chat; this entity controls how those requests are grouped and revisited in
 * Mayday.
 */
@Getter
@Setter
@Table(value = "biz_telegram_conversation", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramConversation extends BaseEntity
{
    /** Mayday user who created the conversation; every access check starts here. */
    private Long ownerId;

    /** Department captured at creation for the platform's configured data scope. */
    private Long departmentId;

    /** Display title; the first keyword replaces the default title. */
    private String title;

    /** Most recent keyword shown as a compact preview in the conversation list. */
    private String lastKeyword;

    /** Number of user-submitted search turns grouped in this conversation. */
    private Integer searchCount;
}
