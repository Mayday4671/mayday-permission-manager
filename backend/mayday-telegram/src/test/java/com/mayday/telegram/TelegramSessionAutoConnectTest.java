package com.mayday.telegram;

import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import com.mayday.common.util.ModuleSwitches;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramAccountMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.ApplicationEventPublisher;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 使用隔离目录和模拟客户端验证自动恢复、授权边界、失败重试及跨实例目录锁。 */
class TelegramSessionAutoConnectTest
{
    @TempDir
    Path directory;
    private TelegramSettings settings;
    private ModuleSwitches modules;
    private AccessPolicy access;
    private TelegramAccountMapper accounts;
    private UserMapper users;
    private TelegramSessionClientProvider provider;
    private TelegramSessionClient client;
    private TelegramAccount account;
    private SysUser owner;
    private TelegramSessionCoordinator coordinator;
    private final AtomicReference<Consumer<TelegramSessionUpdate>> listener = new AtomicReference<>();

    @BeforeEach
    void setUp()
    {
        settings = mock(TelegramSettings.class);
        when(settings.credentialsConfigured()).thenReturn(true);
        when(settings.sessionEncryptionKeyConfigured()).thenReturn(true);
        when(settings.proxyConfigurationReady()).thenReturn(true);
        when(settings.getDataDirectory()).thenReturn(directory);
        modules = new ModuleSwitches();
        modules.setEnabled(Map.of("telegram", true));
        access = mock(AccessPolicy.class);
        accounts = mock(TelegramAccountMapper.class);
        users = mock(UserMapper.class);
        provider = mock(TelegramSessionClientProvider.class);
        client = mock(TelegramSessionClient.class);
        owner = new SysUser();
        owner.setId(1L);
        owner.setEnabled(true);
        account = new TelegramAccount();
        account.setOwnerId(1L);
        account.setTelegramUserId(123L);
        account.setAuthorizationState("CLOSED");
        when(accounts.findPrimary()).thenReturn(Optional.of(account));
        when(users.findById(1L)).thenReturn(Optional.of(owner));
        when(access.hasFor(owner, "telegram:connect")).thenReturn(true);
        when(access.hasFor(owner, "telegram:view")).thenReturn(true);
        when(access.current()).thenReturn(owner);
        when(provider.open(any(), eq(settings), any(), any())).thenAnswer(invocation -> {
            listener.set(invocation.getArgument(2));
            return client;
        });
        doAnswer(invocation -> {
            listener.get().accept(new TelegramSessionUpdate(TelegramAuthorizationState.CLOSED, null, null));
            return null;
        }).when(client).close();
        coordinator = newCoordinator();
    }

    @AfterEach
    void tearDown()
    {
        coordinator.closeOnShutdown();
    }

    @Test
    void restoresAuthorizedSessionOnceWithoutRequestIdentity()
    {
        coordinator.restoreOnStartup();
        coordinator.restoreOnStartup();
        verify(provider, times(1)).open(any(), eq(settings), any(), any());
        verify(access, never()).current();
        assertThat(account.getAuthorizationState()).isEqualTo("INITIALIZING");
        listener.get().accept(new TelegramSessionUpdate(TelegramAuthorizationState.READY, 123L, null));
        assertThat(coordinator.status().state()).isEqualTo("READY");
    }

    @Test
    void skipsMissingAccountAndUnfinishedAuthorization()
    {
        when(accounts.findPrimary()).thenReturn(Optional.empty());
        coordinator.restoreOnStartup();
        when(accounts.findPrimary()).thenReturn(Optional.of(account));
        account.setTelegramUserId(null);
        account.setAuthorizationState("WAITING_FOR_CODE");
        coordinator.restoreOnStartup();
        verifyNoInteractions(provider, users);
    }

    @Test
    void skipsLoggedOutAccountEvenWithStaleUserId()
    {
        account.setAuthorizationState("LOGGED_OUT");
        coordinator.restoreOnStartup();
        verifyNoInteractions(provider, users);
    }

    @Test
    void skipsDisabledModuleAndIncompleteConfiguration()
    {
        modules.setEnabled(Map.of("telegram", false));
        coordinator.restoreOnStartup();
        modules.setEnabled(Map.of("telegram", true));
        when(settings.credentialsConfigured()).thenReturn(false);
        coordinator.restoreOnStartup();
        when(settings.credentialsConfigured()).thenReturn(true);
        when(settings.sessionEncryptionKeyConfigured()).thenReturn(false);
        coordinator.restoreOnStartup();
        when(settings.sessionEncryptionKeyConfigured()).thenReturn(true);
        when(settings.proxyConfigurationReady()).thenReturn(false);
        coordinator.restoreOnStartup();
        verifyNoInteractions(provider, accounts);
    }

    @Test
    void requiresCurrentOwnerAndBothPermissions()
    {
        when(users.findById(1L)).thenReturn(Optional.empty());
        coordinator.restoreOnStartup();
        when(users.findById(1L)).thenReturn(Optional.of(owner));
        when(access.hasFor(owner, "telegram:connect")).thenReturn(false);
        coordinator.restoreOnStartup();
        when(access.hasFor(owner, "telegram:connect")).thenReturn(true);
        when(access.hasFor(owner, "telegram:view")).thenReturn(false);
        coordinator.restoreOnStartup();
        verifyNoInteractions(provider);
    }

    @Test
    void failedNativeStartupDoesNotFailApplicationOrKeepDirectoryLocked()
    {
        when(provider.open(any(), eq(settings), any(), any())).thenThrow(new IllegalStateException("test"))
                .thenAnswer(invocation -> {
                    listener.set(invocation.getArgument(2));
                    return client;
                });
        assertDoesNotThrow(coordinator::restoreOnStartup);
        assertThat(account.getAuthorizationState()).isEqualTo("ERROR");
        assertThat(coordinator.start().connected()).isTrue();
        verify(provider, times(2)).open(any(), eq(settings), any(), any());
    }

    @Test
    void manualCloseRetainsAuthorizationWithoutReopening()
    {
        coordinator.restoreOnStartup();
        coordinator.close();
        assertThat(coordinator.status().connected()).isFalse();
        assertThat(account.getTelegramUserId()).isEqualTo(123L);
        verify(provider, times(1)).open(any(), eq(settings), any(), any());
    }

    @Test
    void competingInstanceCannotOpenAnAlreadyLockedSession()
    {
        coordinator.restoreOnStartup();
        TelegramSessionCoordinator competing = newCoordinator();
        assertDoesNotThrow(competing::restoreOnStartup);
        verify(provider, times(1)).open(any(), eq(settings), any(), any());
        coordinator.closeOnShutdown();
        competing.restoreOnStartup();
        verify(provider, times(2)).open(any(), eq(settings), any(), any());
        competing.closeOnShutdown();
    }

    private TelegramSessionCoordinator newCoordinator()
    {
        return new TelegramSessionCoordinator(settings, new TelegramModuleGuard(modules), modules, access, accounts,
                users, provider, mock(ApplicationEventPublisher.class));
    }
}
