package com.mayday.telegram;

import java.time.LocalDateTime;

/** Safe owner-scoped summary used by the Telegram conversation sidebar. */
public record TelegramConversationView(Long id, String title, String lastKeyword, Integer searchCount,
        LocalDateTime createdAt, LocalDateTime updatedAt) {
    /** Projects only fields needed to render and select one conversation. */
    public static TelegramConversationView from(TelegramConversation entity)
    {
        return new TelegramConversationView(entity.getId(), entity.getTitle(), entity.getLastKeyword(),
                entity.getSearchCount(), entity.getCreatedAt(), entity.getUpdatedAt());
    }
}
