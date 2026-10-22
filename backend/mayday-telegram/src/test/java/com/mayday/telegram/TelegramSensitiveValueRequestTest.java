package com.mayday.telegram;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Ensures one-time Telegram authentication values cannot leak through DTO
 * diagnostics.
 */
class TelegramSensitiveValueRequestTest
{
    /**
     * Redacts both phone numbers and authentication secrets from request-object
     * string representations.
     */
    @Test
    void shouldRedactSensitiveRequestValues()
    {
        TelegramSensitiveValueRequest request = new TelegramSensitiveValueRequest();
        request.setValue("very-secret-code");
        TelegramPhoneRequest phone = new TelegramPhoneRequest();
        phone.setValue("+8613800000000");

        assertFalse(request.toString().contains("very-secret-code"));
        assertFalse(phone.toString().contains("13800000000"));
        assertEquals("very-secret-code", request.getValue());
    }
}
