package com.mayday.telegram;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifies that deployment credentials remain server-only and session
 * encryption is rejected unless sufficiently strong.
 */
class TelegramSettingsTest
{
    /**
     * Accepts a positive numeric API ID, non-empty hash, and 256-bit base64 session
     * key without echoing them.
     */
    @Test
    void shouldValidateCredentialsAndStrongSessionEncryptionKey()
    {
        TelegramSettings settings = new TelegramSettings();
        byte[] expectedKey = new byte[32];
        for (int index = 0; index < expectedKey.length; index++)
        {
            expectedKey[index] = (byte) index;
        }
        settings.setApiId("123456");
        settings.setApiHash("private-value");
        settings.setSessionEncryptionKey(Base64.getEncoder().encodeToString(expectedKey));

        assertTrue(settings.credentialsConfigured());
        assertTrue(settings.sessionEncryptionKeyConfigured());
        assertArrayEquals(expectedKey, settings.sessionEncryptionKey());
        assertFalse(settings.toString().contains("private-value"));
        assertFalse(settings.toString().contains(Base64.getEncoder().encodeToString(expectedKey)));
    }

    /**
     * Rejects malformed or short keys and invalid application IDs without exposing
     * the supplied values.
     */
    @Test
    void shouldRejectIncompleteCredentialsAndWeakKeys()
    {
        TelegramSettings settings = new TelegramSettings();
        settings.setApiId("0");
        settings.setApiHash("");
        settings.setSessionEncryptionKey(Base64.getEncoder().encodeToString(new byte[16]));

        assertFalse(settings.credentialsConfigured());
        assertFalse(settings.sessionEncryptionKeyConfigured());

        settings.setSessionEncryptionKey("not-base64!");
        assertFalse(settings.sessionEncryptionKeyConfigured());
    }

    /** Keeps operator-configured media limits within the documented safe bounds. */
    @Test
    void shouldClampMediaResourcePolicies()
    {
        TelegramSettings settings = new TelegramSettings();

        settings.setMaxStoredMediaBytes(Long.MAX_VALUE);
        settings.setMinimumFreeDiskBytes(-1);
        settings.setMaxMediaWorkers(100);
        settings.setMediaDownloadTimeoutSeconds(1);
        settings.setMediaRetentionDays(5000);

        assertTrue(settings.getMaxStoredMediaBytes() <= 2L * 1024 * 1024 * 1024 * 1024);
        assertTrue(settings.getMinimumFreeDiskBytes() >= 0);
        assertTrue(settings.getMaxMediaWorkers() <= 8);
        assertTrue(settings.getMediaDownloadTimeoutSeconds() >= 30);
        assertTrue(settings.getMediaRetentionDays() <= 3650);
    }

    /**
     * Confirms capability checks only expose availability and accept trusted paths.
     */
    @Test
    void shouldDetectArchiveAndVideoToolsWithoutExposingConfiguredPaths() throws IOException
    {
        TelegramSettings settings = new TelegramSettings();
        Path executable = Files.createTempFile("telegram-tool-", ".bin");
        executable.toFile().setExecutable(true);
        try
        {
            settings.setSevenZipPath(executable.toString());
            settings.setFfmpegPath(executable.toString());
            settings.setFfprobePath(executable.resolveSibling("missing-ffprobe").toString());

            assertTrue(settings.archiveToolAvailable());
            assertTrue(settings.ffmpegAvailable());
            assertFalse(settings.ffprobeAvailable());
            assertFalse(settings.toString().contains(executable.toString()));
        } finally
        {
            Files.deleteIfExists(executable);
        }
    }

    /**
     * Validates native TDLib proxy configuration without exposing private
     * credentials.
     */
    @Test
    void shouldValidateOptionalProxyAndItsAuthenticationRequirements()
    {
        TelegramSettings settings = new TelegramSettings();
        assertTrue(settings.proxyConfigurationReady());

        settings.setProxyEnabled(true);
        assertFalse(settings.proxyConfigurationReady());

        settings.setProxyType("SOCKS5");
        settings.setProxyHost("proxy.example.net");
        settings.setProxyPort(1080);
        settings.setProxyUsername("private-user");
        settings.setProxyPassword("private-password");
        assertTrue(settings.proxyConfigurationReady());

        settings.setProxyType("mtproto");
        assertFalse(settings.proxyConfigurationReady());
        settings.setProxySecret("private-secret");
        assertTrue(settings.proxyConfigurationReady());

        settings.setProxyPort(65536);
        assertFalse(settings.proxyConfigurationReady());
        assertFalse(settings.toString().contains("private-user"));
        assertFalse(settings.toString().contains("private-password"));
        assertFalse(settings.toString().contains("private-secret"));
    }
}
