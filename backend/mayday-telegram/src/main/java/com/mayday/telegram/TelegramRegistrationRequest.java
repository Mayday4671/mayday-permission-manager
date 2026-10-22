package com.mayday.telegram;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Names required only when Telegram asks a new user account to complete profile
 * registration.
 */
public record TelegramRegistrationRequest(@NotBlank @Size(max = 64) String firstName, @Size(max = 64) String lastName) {
}
