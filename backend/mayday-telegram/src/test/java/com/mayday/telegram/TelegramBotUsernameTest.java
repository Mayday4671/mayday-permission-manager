package com.mayday.telegram;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Prevents malformed deployment usernames from being sent as Telegram search
 * destinations.
 */
class TelegramBotUsernameTest
{
    /**
     * Accepts the documented default and optional at-sign while normalizing the
     * configured value.
     */
    @Test
    void shouldNormalizePublicUsernames()
    {
        assertEquals("jisou", TelegramBotUsername.normalize("@jisou"));
        assertEquals("jisou", TelegramBotUsername.normalize(" jisou "));
    }

    /**
     * Rejects arbitrary URLs and unsupported username characters before any client
     * request.
     */
    @Test
    void shouldRejectInvalidUsernames()
    {
        assertThrows(IllegalArgumentException.class, () -> TelegramBotUsername.normalize("https://example.com"));
        assertThrows(IllegalArgumentException.class, () -> TelegramBotUsername.normalize("four"));
    }
}
