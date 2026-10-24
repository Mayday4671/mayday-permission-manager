package com.mayday.telegram;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.function.Supplier;

import jakarta.annotation.PreDestroy;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.util.ModuleSwitches;
import com.mayday.security.AccessPolicy;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramAccountMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * Coordinates the single persistent Telegram account and its long-lived TDLib
 * session.
 *
 * <p>
 * The database row defines ownership across application restarts. A filesystem
 * lock prevents two processes that share the configured data directory from
 * opening the same TDLib database at once. All credential submissions stay in
 * memory.
 */
@Service
@RequiredArgsConstructor
public class TelegramSessionCoordinator
{
    private final TelegramSettings settings;
    private final TelegramModuleGuard moduleGuard;
    private final ModuleSwitches modules;
    private final AccessPolicy access;
    private final TelegramAccountMapper accounts;
    private final UserMapper users;
    private final TelegramSessionClientProvider clientProvider;
    private final ApplicationEventPublisher events;

    private final Object mutex = new Object();
    private volatile TelegramSessionClient client;
    private volatile TelegramAuthorizationState liveState = TelegramAuthorizationState.NOT_CONNECTED;
    private volatile String liveMessage;
    private FileChannel lockChannel;
    private FileLock sessionLock;

    /**
     * Runs a configuration update under the same lock used by connection startup,
     * preventing a mid-connect change.
     */
    <T> T whileDisconnected(Supplier<T> update)
    {
        synchronized (mutex)
        {
            if (client != null)
            {
                throw new BusinessException("请先关闭 Telegram 连接，再修改运行配置");
            }
            return update.get();
        }
    }

    /**
     * Returns account and environment readiness without exposing credentials, full
     * phone number or session path.
     *
     * @return safe client status for the current authorized user
     */
    public TelegramStatusView status()
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        TelegramAccount account = accounts.findPrimary().orElse(null);
        if (account != null)
        {
            requireAccountVisibility(account);
        }
        boolean sessionActive = client != null;
        TelegramAuthorizationState state = account == null
                ? TelegramAuthorizationState.NOT_CONNECTED
                : sessionActive ? liveState : parseStoredState(account.getAuthorizationState());
        state = stateForStatus(sessionActive, state);
        return new TelegramStatusView(modules.isEnabled("telegram"), settings.credentialsConfigured(),
                settings.sessionEncryptionKeyConfigured(), settings.isProxyEnabled(),
                settings.proxyConfigurationReady(), settings.getProxyType(), settings.archiveToolAvailable(),
                settings.ffmpegAvailable() && settings.ffprobeAvailable(), account != null, sessionActive, state.name(),
                liveMessage == null ? stateMessage(state) : liveMessage,
                account == null ? null : account.getMaskedPhoneNumber(),
                account == null || account.getTelegramUserId() == null ? null : account.getTelegramUserId().toString());
    }

    /**
     * Reads the current TDLib user and the configured bot's existing block-list
     * state, enforcing the same account visibility boundary as the status page.
     * This diagnostic does not send messages or change Telegram settings.
     *
     * @return safe identifiers and read-only block-list information
     */
    public TelegramBotSessionDiagnostic inspectSearchBotSession()
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        TelegramAccount account = accounts.findPrimary().orElseThrow(() -> new BusinessException("请先连接 Telegram 账号"));
        requireAccountVisibility(account);
        TelegramSessionClient currentClient;
        synchronized (mutex)
        {
            if (client == null || liveState != TelegramAuthorizationState.READY)
            {
                throw new BusinessException("请先完成 Telegram 账号授权并保持连接");
            }
            currentClient = client;
        }
        try
        {
            return currentClient.inspectBotSession(settings.getSearchBotUsername())
                    .orTimeout(15, java.util.concurrent.TimeUnit.SECONDS).join();
        } catch (java.util.concurrent.CompletionException exception)
        {
            throw new BusinessException("读取 Telegram 搜索机器人状态失败，请检查当前连接与机器人配置");
        }
    }

    /**
     * Starts the TDLib client from the administrative page; native code loads only
     * after all gates pass.
     *
     * @return the current state immediately; authorization continues asynchronously
     */
    public TelegramStatusView start()
    {
        moduleGuard.requireEnabled();
        access.require("telegram:connect");
        requireCredentials();
        synchronized (mutex)
        {
            if (client != null)
            {
                return status();
            }
            TelegramAccount account = claimOrLoadAccount();
            acquireSessionLock();
            try
            {
                liveState = TelegramAuthorizationState.INITIALIZING;
                updateAccount(account, liveState, account.getMaskedPhoneNumber(), account.getTelegramUserId());
                client = clientProvider.open(sessionDirectory(), settings, this::onSessionUpdate,
                        this::onMessageSnapshot);
                return status();
            } catch (RuntimeException exception)
            {
                liveState = TelegramAuthorizationState.ERROR;
                updateAccount(account, liveState, account.getMaskedPhoneNumber(), account.getTelegramUserId());
                releaseSessionLock();
                throw new BusinessException("Telegram 客户端未能启动，请检查 TDLib 运行环境和会话目录权限");
            }
        }
    }

    /**
     * Starts a user-authorized bot search only while the single Telegram account is
     * ready and visible to the caller. The returned client remains an internal
     * module boundary; controllers cannot invoke TDLib directly.
     */
    TelegramSessionClient requireReadyClient(String requiredPermission)
    {
        moduleGuard.requireEnabled();
        access.require(requiredPermission);
        synchronized (mutex)
        {
            TelegramAccount account = accounts.findPrimary()
                    .orElseThrow(() -> new BusinessException("请先连接 Telegram 账号"));
            if (client == null || liveState != TelegramAuthorizationState.READY)
            {
                throw new BusinessException("请先完成 Telegram 账号授权并保持连接");
            }
            requireAccountVisibility(account);
            return client;
        }
    }

    /**
     * Revalidates a persisted task owner's current role and data scope before a
     * background worker uses the shared account. This path does not depend on a
     * request-thread SecurityContext.
     */
    TelegramSessionClient requireTaskClient(Long taskOwnerId)
    {
        moduleGuard.requireEnabled();
        SysUser taskOwner = users.findById(taskOwnerId)
                .orElseThrow(() -> new org.springframework.security.access.AccessDeniedException("任务所有者已不存在"));
        if (!access.hasFor(taskOwner, "telegram:collect") || !access.hasFor(taskOwner, "telegram:view"))
        {
            throw new org.springframework.security.access.AccessDeniedException("任务所有者已失去 Telegram 采集或查看权限");
        }
        TelegramAccount account = accounts.findPrimary().orElse(null);
        if (account == null)
        {
            throw new TelegramSessionUnavailableException();
        }
        if (!access.containsFor(taskOwner, "telegram", account.getOwnerId(), account.getDepartmentId()))
        {
            throw new org.springframework.security.access.AccessDeniedException("任务所有者已无法访问 Telegram 账号");
        }
        synchronized (mutex)
        {
            if (client == null || liveState != TelegramAuthorizationState.READY)
            {
                throw new TelegramSessionUnavailableException();
            }
            return client;
        }
    }

    /**
     * Revalidates the separate media-download permission before a worker reads a
     * native TDLib file.
     */
    TelegramSessionClient requireMediaClient(Long taskOwnerId)
    {
        moduleGuard.requireEnabled();
        SysUser taskOwner = users.findById(taskOwnerId)
                .orElseThrow(() -> new org.springframework.security.access.AccessDeniedException("任务所有者已不存在"));
        if (!access.hasFor(taskOwner, "telegram:download") || !access.hasFor(taskOwner, "telegram:view"))
        {
            throw new org.springframework.security.access.AccessDeniedException("任务所有者已失去 Telegram 媒体下载权限");
        }
        TelegramAccount account = accounts.findPrimary().orElse(null);
        if (account == null)
        {
            throw new TelegramSessionUnavailableException();
        }
        if (!access.containsFor(taskOwner, "telegram", account.getOwnerId(), account.getDepartmentId()))
        {
            throw new org.springframework.security.access.AccessDeniedException("任务所有者已无法访问 Telegram 账号");
        }
        synchronized (mutex)
        {
            if (client == null || liveState != TelegramAuthorizationState.READY)
            {
                throw new TelegramSessionUnavailableException();
            }
            return client;
        }
    }

    /**
     * Delivers only allow-listed bot chat snapshots to the persisted search inbox.
     */
    private void onMessageSnapshot(TelegramMessageSnapshot snapshot)
    {
        moduleGuard.requireEnabled();
        events.publishEvent(snapshot);
    }

    /** Submits a phone challenge only while TDLib is waiting for a phone number. */
    public TelegramStatusView submitPhoneNumber(String phoneNumber)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:connect");
        synchronized (mutex)
        {
            requireExpectedState(TelegramAuthorizationState.WAITING_FOR_PHONE);
            TelegramAccount account = requireOwnedAccount();
            liveMessage = "手机号已提交，正在等待 Telegram 返回授权结果；验证码可能发送到已登录的 Telegram 客户端。";
            try
            {
                client.submitPhoneNumber(phoneNumber);
            } catch (RuntimeException exception)
            {
                liveMessage = null;
                throw exception;
            }
            updateAccount(account, liveState, maskPhoneNumber(phoneNumber), account.getTelegramUserId());
            return status();
        }
    }

    /**
     * Submits a one-time code only when Telegram has requested it; the value is
     * never persisted.
     */
    public TelegramStatusView submitCode(String code)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:connect");
        synchronized (mutex)
        {
            requireExpectedState(TelegramAuthorizationState.WAITING_FOR_CODE);
            client.submitCode(code);
            return status();
        }
    }

    /**
     * Submits a Telegram two-step verification password only when it is requested.
     */
    public TelegramStatusView submitPassword(String password)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:connect");
        synchronized (mutex)
        {
            requireExpectedState(TelegramAuthorizationState.WAITING_FOR_PASSWORD);
            client.submitPassword(password);
            return status();
        }
    }

    /** Submits the additional email address challenge when Telegram requires it. */
    public TelegramStatusView submitEmailAddress(String emailAddress)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:connect");
        synchronized (mutex)
        {
            requireExpectedState(TelegramAuthorizationState.WAITING_FOR_EMAIL_ADDRESS);
            client.submitEmailAddress(emailAddress);
            return status();
        }
    }

    /**
     * Submits an email verification code without storing it in the account row or
     * audit payload.
     */
    public TelegramStatusView submitEmailCode(String code)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:connect");
        synchronized (mutex)
        {
            requireExpectedState(TelegramAuthorizationState.WAITING_FOR_EMAIL_CODE);
            client.submitEmailCode(code);
            return status();
        }
    }

    /**
     * Completes Telegram profile registration when the authorization flow requests
     * first and last name.
     */
    public TelegramStatusView register(String firstName, String lastName)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:connect");
        synchronized (mutex)
        {
            requireExpectedState(TelegramAuthorizationState.WAITING_FOR_REGISTRATION);
            client.register(firstName, lastName);
            return status();
        }
    }

    /**
     * Closes TDLib while preserving the authorized database for a later restart.
     */
    public TelegramStatusView close()
    {
        moduleGuard.requireEnabled();
        access.require("telegram:disconnect");
        synchronized (mutex)
        {
            TelegramAccount account = requireOwnedAccount();
            if (client == null)
            {
                return status();
            }
            liveState = TelegramAuthorizationState.CLOSING;
            updateAccount(account, liveState, account.getMaskedPhoneNumber(), account.getTelegramUserId());
            client.close();
            return status();
        }
    }

    /**
     * Explicitly logs out and clears the reusable TDLib authorization session; this
     * operation is separately permissioned.
     */
    public TelegramStatusView logOut()
    {
        moduleGuard.requireEnabled();
        access.require("telegram:logout");
        synchronized (mutex)
        {
            TelegramAccount account = requireOwnedAccount();
            if (client == null || liveState != TelegramAuthorizationState.READY)
            {
                throw new BusinessException("账号当前未连接，无法安全退出 Telegram 账号");
            }
            liveState = TelegramAuthorizationState.CLOSING;
            updateAccount(account, liveState, account.getMaskedPhoneNumber(), account.getTelegramUserId());
            client.logOut();
            return status();
        }
    }

    /**
     * Validates the sensitive deployment prerequisites before any native library or
     * external connection is initialized.
     */
    private void requireCredentials()
    {
        if (!settings.credentialsConfigured())
        {
            throw new BusinessException("请先由部署人员配置 Telegram API 凭据并重启服务");
        }
        if (!settings.sessionEncryptionKeyConfigured())
        {
            throw new BusinessException("请先由部署人员配置 Telegram 会话加密密钥并重启服务");
        }
        if (!settings.proxyConfigurationReady())
        {
            throw new BusinessException("Telegram 代理配置不完整或无效，请检查部署环境后重启服务");
        }
    }

    /**
     * Atomically claims or loads the global slot while preserving its original
     * owner across restarts.
     */
    private TelegramAccount claimOrLoadAccount()
    {
        Long currentUserId = access.current().getId();
        accounts.ensurePrimarySlot(currentUserId, access.current().getDepartmentId());
        TelegramAccount account = accounts.findPrimary()
                .orElseThrow(() -> new BusinessException("Telegram 账号槽位未能初始化，请检查数据库迁移"));
        requireAccountManagement(account);
        return account;
    }

    /**
     * Loads the persisted singleton and applies the same ownership boundary used by
     * every account action.
     */
    private TelegramAccount requireOwnedAccount()
    {
        TelegramAccount account = accounts.findPrimary().orElseThrow(() -> new BusinessException("请先连接 Telegram 账号"));
        requireAccountManagement(account);
        return account;
    }

    /**
     * Allows the recorded owner or a holder of the explicit all-accounts permission
     * to manage this global account.
     */
    private void requireAccountManagement(TelegramAccount account)
    {
        Long currentUserId = access.current().getId();
        if (!currentUserId.equals(account.getOwnerId()) && !access.admin() && !access.has("telegram:all"))
        {
            throw new AccessDeniedException("Telegram 账号由其他管理员管理");
        }
    }

    /**
     * Applies read-scope checks before returning even a non-secret status belonging
     * to another user's account.
     */
    private void requireAccountVisibility(TelegramAccount account)
    {
        Long currentUserId = access.current().getId();
        if (!currentUserId.equals(account.getOwnerId()) && !access.admin() && !access.has("telegram:all")
                && !access.contains("telegram", account.getOwnerId(), account.getDepartmentId()))
        {
            throw new AccessDeniedException("当前数据范围不可查看此 Telegram 账号");
        }
    }

    /**
     * Rejects stale credential submissions rather than sending them to an unrelated
     * authorization step.
     */
    private void requireExpectedState(TelegramAuthorizationState expected)
    {
        requireOwnedAccount();
        if (client == null || liveState != expected)
        {
            throw new BusinessException("Telegram 授权状态已变化，请刷新页面后重试");
        }
    }

    /**
     * Prevents a persisted challenge from being presented as actionable after a
     * process restart, when its TDLib client is no longer running. The next
     * explicit reconnect lets TDLib restore and publish the real authorization
     * step.
     *
     * @param sessionActive
     *            whether the current process owns an active TDLib client
     * @param state
     *            stored or live authorization state
     * @return the safe state that the status API should expose
     */
    static TelegramAuthorizationState stateForStatus(boolean sessionActive, TelegramAuthorizationState state)
    {
        if (sessionActive)
        {
            return state;
        }
        return switch (state)
        {
            case INITIALIZING, WAITING_FOR_PHONE, WAITING_FOR_CODE, WAITING_FOR_PASSWORD, WAITING_FOR_EMAIL_ADDRESS,
                    WAITING_FOR_EMAIL_CODE, WAITING_FOR_REGISTRATION, WAITING_FOR_DEVICE_CONFIRMATION, READY, CLOSING ->
                TelegramAuthorizationState.CLOSED;
            default -> state;
        };
    }

    /**
     * Persists only safe summary state; version checks prevent late updates from
     * overwriting newer account state.
     */
    private void updateAccount(TelegramAccount account, TelegramAuthorizationState state, String maskedPhoneNumber,
            Long telegramUserId)
    {
        account.setAuthorizationState(state.name());
        account.setMaskedPhoneNumber(maskedPhoneNumber);
        account.setTelegramUserId(telegramUserId);
        accounts.save(account);
    }

    /**
     * Serializes TDLib callback writes and releases the local lock after the client
     * is closed.
     */
    private void onSessionUpdate(TelegramSessionUpdate update)
    {
        synchronized (mutex)
        {
            liveState = update.state();
            liveMessage = update.message();
            TelegramAccount account = accounts.findPrimary().orElse(null);
            if (account != null)
            {
                String phone = update.state() == TelegramAuthorizationState.LOGGED_OUT
                        ? null
                        : account.getMaskedPhoneNumber();
                Long telegramUserId = update.telegramUserId() == null
                        ? account.getTelegramUserId()
                        : update.telegramUserId();
                if (update.state() == TelegramAuthorizationState.LOGGED_OUT)
                {
                    telegramUserId = null;
                }
                updateAccount(account, update.state(), phone, telegramUserId);
            }
            if (update.state() == TelegramAuthorizationState.CLOSED
                    || update.state() == TelegramAuthorizationState.LOGGED_OUT)
            {
                client = null;
                releaseSessionLock();
            }
        }
    }

    /**
     * Creates and validates a private session directory without following a symlink
     * at the account boundary.
     */
    private Path sessionDirectory()
    {
        Path root = settings.getDataDirectory().toAbsolutePath().normalize();
        Path directory = root.resolve("primary").normalize();
        if (!directory.startsWith(root))
        {
            throw new BusinessException("Telegram 会话目录配置无效");
        }
        try
        {
            Files.createDirectories(root);
            if (Files.isSymbolicLink(directory))
            {
                throw new BusinessException("Telegram 会话目录不能是符号链接");
            }
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory.resolve("database")) || Files.isSymbolicLink(directory.resolve("files")))
            {
                throw new BusinessException("Telegram 会话子目录不能是符号链接");
            }
            Files.createDirectories(directory.resolve("database"));
            Files.createDirectories(directory.resolve("files"));
            return directory;
        } catch (IOException exception)
        {
            throw new BusinessException("无法创建 Telegram 会话目录，请检查本机目录权限");
        }
    }

    /**
     * Locks the account directory across processes before TDLib can open its SQLite
     * and file databases.
     */
    private void acquireSessionLock()
    {
        Path directory = sessionDirectory();
        try
        {
            lockChannel = FileChannel.open(directory.resolve("session.lock"), StandardOpenOption.CREATE,
                    StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
            sessionLock = lockChannel.tryLock();
            if (sessionLock == null)
            {
                releaseSessionLock();
                throw new BusinessException("Telegram 会话已被另一个应用实例占用");
            }
        } catch (IOException | OverlappingFileLockException exception)
        {
            releaseSessionLock();
            throw new BusinessException("无法独占 Telegram 会话目录；请确认没有其他 Mayday 实例正在使用它");
        }
    }

    /**
     * Releases the operating-system file lock after session close or a failed
     * initialization.
     */
    private void releaseSessionLock()
    {
        try
        {
            if (sessionLock != null && sessionLock.isValid())
            {
                sessionLock.release();
            }
            if (lockChannel != null && lockChannel.isOpen())
            {
                lockChannel.close();
            }
        } catch (IOException ignored)
        {
            // The OS releases this lock when the process exits; never log file system paths
            // or native session details.
        } finally
        {
            sessionLock = null;
            lockChannel = null;
        }
    }

    /**
     * Returns a formatted phone hint without storing or displaying the full login
     * identifier.
     */
    private String maskPhoneNumber(String phoneNumber)
    {
        String digits = phoneNumber.replaceAll("\\D", "");
        return digits.length() < 4
                ? "***"
                : "+" + "*".repeat(Math.max(0, digits.length() - 4)) + digits.substring(digits.length() - 4);
    }

    /**
     * Converts persisted values to the public enum; unknown historical values never
     * imply a ready session.
     */
    private TelegramAuthorizationState parseStoredState(String state)
    {
        try
        {
            return state == null ? TelegramAuthorizationState.NOT_CONNECTED : TelegramAuthorizationState.valueOf(state);
        } catch (IllegalArgumentException exception)
        {
            return TelegramAuthorizationState.UNSUPPORTED;
        }
    }

    /**
     * Provides fixed user-facing descriptions instead of exposing TDLib error
     * messages or internal exceptions.
     */
    private String stateMessage(TelegramAuthorizationState state)
    {
        return switch (state)
        {
            case NOT_CONNECTED -> "Telegram 账号尚未连接";
            case INITIALIZING -> "正在初始化加密会话，请稍候";
            case WAITING_FOR_PHONE -> "请输入 Telegram 手机号以接收授权验证码";
            case WAITING_FOR_CODE -> "请输入 Telegram 客户端收到的验证码";
            case WAITING_FOR_PASSWORD -> "请输入 Telegram 两步验证密码";
            case WAITING_FOR_EMAIL_ADDRESS -> "Telegram 要求提供邮箱地址";
            case WAITING_FOR_EMAIL_CODE -> "请输入 Telegram 邮箱验证码";
            case WAITING_FOR_REGISTRATION -> "Telegram 要求完善账号姓名";
            case WAITING_FOR_DEVICE_CONFIRMATION -> "请在 Telegram 客户端确认本次登录";
            case READY -> "Telegram 账号已授权并连接";
            case CLOSING -> "正在安全关闭连接并保留本地授权会话";
            case CLOSED -> "连接已关闭；本地授权会话已保留，可重新连接";
            case LOGGED_OUT -> "Telegram 账号已退出，本地授权凭据已清除";
            case ERROR -> "Telegram 客户端发生错误，请检查服务端运行状态后重试";
            case UNSUPPORTED -> "Telegram 返回了当前界面尚不支持的授权步骤";
        };
    }

    /**
     * Closes the active client during application shutdown without issuing Telegram
     * LogOut.
     */
    @PreDestroy
    public void closeOnShutdown()
    {
        synchronized (mutex)
        {
            if (client != null)
            {
                client.close();
            }
        }
    }

    /**
     * Safe API response containing only module readiness and account summary
     * metadata.
     */
    public record TelegramStatusView(boolean enabled, boolean credentialsConfigured, boolean encryptionKeyConfigured,
            boolean proxyEnabled, boolean proxyConfigured, String proxyType, boolean archiveToolAvailable,
            boolean videoPreviewToolsAvailable, boolean accountConfigured, boolean connected, String state,
            String message, String maskedPhoneNumber, String telegramUserId) {
    }
}
