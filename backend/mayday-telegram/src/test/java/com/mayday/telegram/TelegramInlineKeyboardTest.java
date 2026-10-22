package com.mayday.telegram;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Protects the callback action boundary against arbitrary client-supplied data.
 */
class TelegramInlineKeyboardTest
{
    /**
     * Only callback buttons stored in the captured keyboard return payload bytes.
     */
    @Test
    void shouldResolveStoredCallbackPayload()
    {
        String encoded = Base64.getEncoder().encodeToString("next".getBytes(StandardCharsets.UTF_8));
        String keyboard = "[[{\"text\":\"下一页\",\"type\":\"CALLBACK\",\"data\":\"" + encoded + "\"}]]";

        assertArrayEquals("next".getBytes(StandardCharsets.UTF_8),
                TelegramInlineKeyboard.requireCallbackData(keyboard, 0, 0));
    }

    /**
     * URL buttons, missing indexes and malformed markup never execute as callbacks.
     */
    @Test
    void shouldRejectNonCallbackOrInvalidPosition()
    {
        assertThrows(IllegalArgumentException.class,
                () -> TelegramInlineKeyboard.requireCallbackData("[[{\"text\":\"open\",\"type\":\"URL\"}]]", 0, 0));
        assertThrows(IllegalArgumentException.class, () -> TelegramInlineKeyboard.requireCallbackData("[]", 0, 0));
        assertThrows(IllegalArgumentException.class,
                () -> TelegramInlineKeyboard.requireCallbackData("[[{\"type\":\"CALLBACK\",\"data\":\"%%%\"}]]", 0, 0));
        assertThrows(IllegalArgumentException.class, () -> TelegramInlineKeyboard.requireCallbackData("[]", -1, 0));
    }
}
