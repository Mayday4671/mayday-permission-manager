package com.mayday.telegram;

import java.util.Base64;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifies encrypted Telegram secrets cannot be swapped between config fields
 * or returned as plaintext.
 */
class TelegramConfigurationCipherTest
{
    /**
     * Encrypts one secret at rest, allows authenticated round-trip, and binds
     * ciphertext to its field.
     */
    @Test
    void shouldEncryptSecretsAndBindCiphertextToTheRequestedField()
    {
        String key = Base64.getEncoder().encodeToString(new byte[32]);
        TelegramConfigurationCipher cipher = new TelegramConfigurationCipher(key);
        String ciphertext = cipher.encrypt("api-hash", "private-telegram-hash");

        assertTrue(cipher.available());
        assertFalse(ciphertext.contains("private-telegram-hash"));
        assertEquals("private-telegram-hash", cipher.decrypt("api-hash", ciphertext));
        assertThrows(IllegalStateException.class, () -> cipher.decrypt("proxy-secret", ciphertext));
    }

    /**
     * Refuses to encrypt when the deployment-owned master key is absent or too
     * short.
     */
    @Test
    void shouldRequireAValidPlatformEncryptionKey()
    {
        TelegramConfigurationCipher cipher = new TelegramConfigurationCipher("");

        assertFalse(cipher.available());
        assertThrows(RuntimeException.class, () -> cipher.encrypt("api-hash", "secret"));
    }
}
