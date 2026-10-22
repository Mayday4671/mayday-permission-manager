package com.mayday.telegram;

/** Non-secret TDLib lifecycle update delivered to the account coordinator. */
public record TelegramSessionUpdate(TelegramAuthorizationState state, Long telegramUserId, String message) {
}
