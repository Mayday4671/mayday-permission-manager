package com.mayday.telegram;

import org.jspecify.annotations.Nullable;

/** Safe channel selector value returned to an authorized Mayday user. */
public record TelegramChannelOption(String chatId, String title, @Nullable String username) {
}
