package com.mayday.telegram;

/**
 * Safe projection of Telegram's callback answer. URLs are returned as inert
 * data for explicit user review and are never opened automatically.
 */
public record TelegramCallbackAnswer(String text, boolean showAlert, String url) {
}
