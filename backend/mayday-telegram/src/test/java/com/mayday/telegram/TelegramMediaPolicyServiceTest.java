package com.mayday.telegram;

import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramMediaPolicyMapper;
import com.mybatisflex.core.row.Row;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Validates durable large-media policy and permission checks independently of
 * Telegram login.
 */
class TelegramMediaPolicyServiceTest
{
    @Test
    void savesUnlimitedPolicyAndRestoresItOnRestart()
    {
        var mapper = mock(TelegramMediaPolicyMapper.class);
        var access = mock(AccessPolicy.class);
        SysUser user = new SysUser();
        user.setId(7L);
        when(access.current()).thenReturn(user);
        var settings = new TelegramSettings();
        var service = new TelegramMediaPolicyService(mapper, settings, access);
        var policy = new TelegramMediaPolicyService.Policy(0, 100L * 1024 * 1024 * 1024, 10800);
        service.save(policy);
        verify(access).require("telegram:configure");
        verify(mapper).savePolicy(0, policy.maxStoredBytes(), 10800, 7L);
        Row row = new Row();
        row.set("max_file_bytes", 0L);
        row.set("max_stored_bytes", policy.maxStoredBytes());
        row.set("download_timeout_seconds", 10800);
        when(mapper.readPolicy()).thenReturn(row);
        var restored = new TelegramSettings();
        new TelegramMediaPolicyService(mapper, restored, access).afterPropertiesSet();
        assertThat(restored.getConfiguredMaxMediaFileBytes()).isZero();
        assertThat(restored.getMaxMediaFileBytes()).isEqualTo(policy.maxStoredBytes());
        assertThat(restored.getMediaDownloadTimeoutSeconds()).isEqualTo(10800);
    }

    @Test
    void rejectsInvalidPolicyAndDoesNotApplyFailedPersistence()
    {
        var mapper = mock(TelegramMediaPolicyMapper.class);
        var access = mock(AccessPolicy.class);
        var settings = new TelegramSettings();
        var service = new TelegramMediaPolicyService(mapper, settings, access);
        assertThatThrownBy(() -> service.save(new TelegramMediaPolicyService.Policy(-1, 1000000000L, 600)))
                .hasMessageContaining("有效");
        verifyNoInteractions(mapper);
        SysUser user = new SysUser();
        user.setId(1L);
        when(access.current()).thenReturn(user);
        doThrow(new IllegalStateException("database unavailable")).when(mapper).savePolicy(1024L, 1000000000L, 600, 1L);
        assertThatThrownBy(() -> service.save(new TelegramMediaPolicyService.Policy(1024, 1000000000L, 600)))
                .isInstanceOf(IllegalStateException.class);
        assertThat(settings.getConfiguredMaxMediaFileBytes()).isZero();
    }
}
