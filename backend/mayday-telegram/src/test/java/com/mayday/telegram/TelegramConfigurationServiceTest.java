package com.mayday.telegram;

import java.util.Base64;
import java.util.List;

import com.mayday.common.util.ModuleSwitches;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramAccountMapper;
import com.mayday.telegram.mapper.TelegramConfigurationMapper;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Exercises safe configuration persistence and immediate application without
 * opening TDLib.
 */
class TelegramConfigurationServiceTest
{
    /**
     * Saves API and proxy values through the disconnected-session boundary while
     * encrypting every secret.
     */
    @Test
    void shouldPersistOnlyEncryptedSecretsAndApplySettingsAfterSaving()
    {
        TelegramConfigurationMapper mapper = mock(TelegramConfigurationMapper.class);
        when(mapper.selectStored()).thenReturn(List.of());
        TelegramSettings settings = new TelegramSettings();
        TelegramConfigurationCipher cipher = new TelegramConfigurationCipher(
                Base64.getEncoder().encodeToString(new byte[32]));
        AccessPolicy access = mock(AccessPolicy.class);
        SysUser administrator = new SysUser();
        administrator.setId(42L);
        when(access.current()).thenReturn(administrator);
        TelegramSessionCoordinator sessions = newSessionCoordinator(access);
        TelegramConfigurationService service = new TelegramConfigurationService(mapper, cipher, settings, sessions,
                access);

        TelegramConfigurationService.SettingsView saved = service.save(new TelegramConfigurationService.SettingsRequest(
                "32293165", "api-hash-sensitive-value", false, "socks5", "", 0, "", "", ""));

        assertTrue(saved.apiHashConfigured());
        assertTrue(saved.sessionKeyConfigured());
        assertTrue(settings.credentialsConfigured());
        assertTrue(settings.sessionEncryptionKeyConfigured());
        assertEquals("32293165", settings.getApiId());
        assertFalse(saved.toString().contains("api-hash-sensitive-value"));
        verify(mapper).upsert(eq("32293165"), anyString(), anyString(), eq(false), eq("socks5"), eq(""), eq(0), eq(""),
                eq(null), eq(null), eq(42L));
    }

    /**
     * Refuses an enabled invalid proxy before either persistent or in-memory
     * settings are changed.
     */
    @Test
    void shouldRejectInvalidProxyWithoutWritingConfiguration()
    {
        TelegramConfigurationMapper mapper = mock(TelegramConfigurationMapper.class);
        when(mapper.selectStored()).thenReturn(List.of());
        TelegramSettings settings = new TelegramSettings();
        settings.setApiHash("existing-api-hash");
        TelegramConfigurationCipher cipher = new TelegramConfigurationCipher(
                Base64.getEncoder().encodeToString(new byte[32]));
        AccessPolicy access = mock(AccessPolicy.class);
        TelegramConfigurationService service = new TelegramConfigurationService(mapper, cipher, settings,
                newSessionCoordinator(access), access);

        assertThrows(RuntimeException.class, () -> service.save(
                new TelegramConfigurationService.SettingsRequest("32293165", "", true, "socks5", "", 0, "", "", "")));

        assertEquals("", settings.getApiId());
        assertEquals("existing-api-hash", settings.getApiHash());
        verify(mapper, never()).upsert(anyString(), anyString(), anyString(), any(boolean.class), anyString(),
                anyString(), any(int.class), anyString(), any(), any(), any());
    }

    private static TelegramSessionCoordinator newSessionCoordinator(AccessPolicy access)
    {
        return new TelegramSessionCoordinator(new TelegramSettings(), mock(TelegramModuleGuard.class),
                mock(ModuleSwitches.class), access, mock(TelegramAccountMapper.class), mock(UserMapper.class),
                mock(TelegramSessionClientProvider.class), mock(ApplicationEventPublisher.class));
    }
}
