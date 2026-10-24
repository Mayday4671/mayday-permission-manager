package com.mayday.telegram;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Locale;

import com.mayday.common.exception.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.mapper.TelegramConfigurationMapper;
import com.mybatisflex.core.row.Row;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.stereotype.Service;

/**
 * Owns the single Telegram runtime configuration and applies it without a
 * service restart.
 *
 * <p>
 * Environment properties are used until an authorized administrator saves an
 * override. Sensitive values are encrypted before persistence and never
 * included in a response.
 */
@Service
@DependsOnDatabaseInitialization
public class TelegramConfigurationService implements InitializingBean
{
    private static final SecureRandom RANDOM = new SecureRandom();
    private final TelegramConfigurationMapper configurations;
    private final TelegramConfigurationCipher cipher;
    private final TelegramSettings settings;
    private final TelegramSessionCoordinator sessions;
    private final AccessPolicy access;

    /**
     * Binds durable configuration storage, deployment defaults, active-session
     * guard, and authorization.
     */
    public TelegramConfigurationService(TelegramConfigurationMapper configurations, TelegramConfigurationCipher cipher,
            TelegramSettings settings, TelegramSessionCoordinator sessions, AccessPolicy access)
    {
        this.configurations = configurations;
        this.cipher = cipher;
        this.settings = settings;
        this.sessions = sessions;
        this.access = access;
    }

    /**
     * Applies stored administrator overrides after the database migrations have
     * completed.
     */
    @Override
    public void afterPropertiesSet()
    {
        configurations.selectStored().stream().findFirst().ifPresent(this::applyStored);
    }

    /**
     * Returns editable non-secret settings and secret-presence flags to authorized
     * operators only.
     */
    public SettingsView getSettings()
    {
        access.require("telegram:configure");
        return view();
    }

    /**
     * Validates, encrypts, commits, and atomically applies an administrator's
     * settings without restarting Java.
     */
    public synchronized SettingsView save(SettingsRequest request)
    {
        access.require("telegram:configure");
        return sessions.whileDisconnected(() -> saveWhileDisconnected(request));
    }

    private SettingsView saveWhileDisconnected(SettingsRequest request)
    {
        validate(request);
        StoredSettings previous = configurations.selectStored().stream().findFirst().map(this::readRow).orElse(null);

        String apiHash = secretOrPrevious(request.apiHash(),
                previous == null ? settings.getApiHash() : decrypt("api-hash", previous.apiHashCipher())).trim();
        if (apiHash.isBlank())
        {
            throw new BusinessException("请输入 Telegram API Hash");
        }

        String sessionKey = settings.getSessionEncryptionKey();
        if (!isValidSessionKey(sessionKey))
        {
            sessionKey = generateSessionKey();
        }

        String proxyPassword = secretOrPrevious(request.proxyPassword(), settings.getProxyPassword());
        String proxyType = request.proxyType().trim().toLowerCase(Locale.ROOT);
        String proxyHost = request.proxyHost().trim();
        String proxyUsername = request.proxyUsername() == null ? "" : request.proxyUsername().trim();
        String proxySecret = "mtproto".equals(proxyType)
                ? secretOrPrevious(request.proxySecret(), settings.getProxySecret())
                : "";
        validateProxy(request.proxyEnabled(), proxyType, proxyHost, request.proxyPort(), proxyUsername, proxyPassword,
                proxySecret);

        String apiHashCipher = cipher.encrypt("api-hash", apiHash);
        String sessionKeyCipher = cipher.encrypt("session-key", sessionKey);
        String proxyPasswordCipher = proxyPassword.isBlank() ? null : cipher.encrypt("proxy-password", proxyPassword);
        String proxySecretCipher = proxySecret.isBlank() ? null : cipher.encrypt("proxy-secret", proxySecret);

        // Database write completes before the shared settings object changes, so failed
        // persistence cannot half-apply.
        configurations.upsert(request.apiId().trim(), apiHashCipher, sessionKeyCipher, request.proxyEnabled(),
                proxyType, proxyHost, request.proxyPort(), proxyUsername, proxyPasswordCipher, proxySecretCipher,
                access.current().getId());
        settings.setApiId(request.apiId());
        settings.setApiHash(apiHash);
        settings.setSessionEncryptionKey(sessionKey);
        settings.setProxyEnabled(request.proxyEnabled());
        settings.setProxyType(proxyType);
        settings.setProxyHost(proxyHost);
        settings.setProxyPort(request.proxyPort());
        settings.setProxyUsername(proxyUsername);
        settings.setProxyPassword(proxyPassword);
        settings.setProxySecret(proxySecret);
        return view();
    }

    private static void validate(SettingsRequest request)
    {
        if (request.apiId() == null || !request.apiId().trim().matches("[1-9][0-9]{0,9}"))
        {
            throw new BusinessException("Telegram API ID 必须是正整数");
        }
        validateSecret(request.apiHash(), "Telegram API Hash", 512);
        validateSecret(request.proxyPassword(), "代理密码", 255);
        validateSecret(request.proxySecret(), "MTProto Secret", 512);
        validateSecret(request.proxyUsername(), "代理用户名", 255);
        String type = request.proxyType() == null ? "" : request.proxyType().trim().toLowerCase(Locale.ROOT);
        if (!List.of("socks5", "http", "mtproto").contains(type))
        {
            throw new BusinessException("代理类型只支持 SOCKS5、HTTP 或 MTProto");
        }
        if (request.proxyHost() == null || request.proxyUsername() == null || request.proxyHost().length() > 253
                || request.proxyHost().chars().anyMatch(Character::isISOControl))
        {
            throw new BusinessException("代理地址长度或格式不正确");
        }
        if (request.proxyPort() < 0 || request.proxyPort() > 65535)
        {
            throw new BusinessException("代理端口必须在 0 至 65535 之间");
        }
    }

    private static void validateProxy(boolean enabled, String type, String host, int port, String username,
            String password, String secret)
    {
        if (!enabled)
        {
            return;
        }
        String normalizedType = type.trim().toLowerCase(Locale.ROOT);
        if (host == null || !host.trim().matches("[A-Za-z0-9.:%_-]{1,253}") || port < 1 || port > 65535)
        {
            throw new BusinessException("启用代理时请填写有效的主机地址和 1 至 65535 之间的端口");
        }
        if (!safeLength(username, 255) || !safeLength(password, 255))
        {
            throw new BusinessException("代理用户名或密码长度不正确");
        }
        if ("mtproto".equals(normalizedType))
        {
            if (secret == null || secret.isBlank() || !secret.matches("[A-Za-z0-9_-]{1,512}"))
            {
                throw new BusinessException("MTProto 代理必须提供有效的 Secret");
            }
        } else if (secret != null && !secret.isBlank())
        {
            throw new BusinessException("SOCKS5 和 HTTP 代理不使用 MTProto Secret");
        }
    }

    private static void validateSecret(String secret, String label, int maxLength)
    {
        if (secret != null && (secret.length() > maxLength || secret.chars().anyMatch(Character::isISOControl)))
        {
            throw new BusinessException(label + "格式不正确");
        }
    }

    private static boolean safeLength(String value, int maximum)
    {
        return value == null || (value.length() <= maximum && value.chars().noneMatch(Character::isISOControl));
    }

    private static String secretOrPrevious(String submitted, String current)
    {
        return submitted == null || submitted.isBlank() ? current == null ? "" : current : submitted;
    }

    private static boolean isValidSessionKey(String value)
    {
        try
        {
            return value != null && Base64.getDecoder().decode(value).length >= 32;
        } catch (IllegalArgumentException ignored)
        {
            return false;
        }
    }

    private static String generateSessionKey()
    {
        byte[] key = new byte[32];
        RANDOM.nextBytes(key);
        try
        {
            return Base64.getEncoder().encodeToString(key);
        } finally
        {
            java.util.Arrays.fill(key, (byte) 0);
        }
    }

    private SettingsView view()
    {
        return new SettingsView(settings.getApiId(), settings.credentialsConfigured(),
                settings.sessionEncryptionKeyConfigured(), settings.isProxyEnabled(), settings.getProxyType(),
                settings.getProxyHost(), settings.getProxyPort(), settings.getProxyUsername(),
                !settings.getProxyPassword().isBlank(), !settings.getProxySecret().isBlank(), cipher.available(),
                !configurations.selectStored().isEmpty());
    }

    private void applyStored(Row row)
    {
        StoredSettings stored = readRow(row);
        settings.setApiId(stored.apiId());
        settings.setApiHash(decrypt("api-hash", stored.apiHashCipher()));
        settings.setSessionEncryptionKey(decrypt("session-key", stored.sessionKeyCipher()));
        settings.setProxyEnabled(stored.proxyEnabled());
        settings.setProxyType(stored.proxyType());
        settings.setProxyHost(stored.proxyHost());
        settings.setProxyPort(stored.proxyPort());
        settings.setProxyUsername(stored.proxyUsername());
        settings.setProxyPassword(decryptOptional("proxy-password", stored.proxyPasswordCipher()));
        settings.setProxySecret(decryptOptional("proxy-secret", stored.proxySecretCipher()));
    }

    private StoredSettings readRow(Row row)
    {
        return new StoredSettings(row.getString("api_id"), row.getString("api_hash_cipher"),
                row.getString("session_encryption_key_cipher"), Boolean.TRUE.equals(row.getBoolean("proxy_enabled")),
                row.getString("proxy_type"), row.getString("proxy_host"), row.getInt("proxy_port"),
                row.getString("proxy_username"), row.getString("proxy_password_cipher"),
                row.getString("proxy_secret_cipher"));
    }

    private String decrypt(String field, String encrypted)
    {
        return encrypted == null || encrypted.isBlank() ? "" : cipher.decrypt(field, encrypted);
    }

    private String decryptOptional(String field, String encrypted)
    {
        return decrypt(field, encrypted);
    }

    /**
     * Persisted connection settings keep credential ciphertext separate from public
     * configuration responses.
     */
    private record StoredSettings(String apiId, String apiHashCipher, String sessionKeyCipher, boolean proxyEnabled,
            String proxyType, String proxyHost, int proxyPort, String proxyUsername, String proxyPasswordCipher,
            String proxySecretCipher) {
    }

    /**
     * Read response intentionally contains secret-presence flags only and never a
     * credential value.
     */
    public record SettingsView(String apiId, boolean apiHashConfigured, boolean sessionKeyConfigured,
            boolean proxyEnabled, String proxyType, String proxyHost, int proxyPort, String proxyUsername,
            boolean proxyPasswordConfigured, boolean proxySecretConfigured, boolean encryptionAvailable,
            boolean databaseOverride) {
    }

    /**
     * Write model accepts replacement secrets once; empty secret fields retain
     * their current values.
     */
    public record SettingsRequest(String apiId, String apiHash, boolean proxyEnabled, String proxyType,
            String proxyHost, int proxyPort, String proxyUsername, String proxyPassword, String proxySecret) {

        /**
         * Prevents diagnostic rendering from including write-only API or proxy
         * credentials.
         */
        @Override
        public String toString()
        {
            return "SettingsRequest[apiId=" + apiId + ", apiHash=<redacted>, proxyEnabled=" + proxyEnabled
                    + ", proxyType=" + proxyType + ", proxyHost=" + proxyHost + ", proxyPort=" + proxyPort
                    + ", proxyUsername=" + proxyUsername + ", proxyPassword=<redacted>, proxySecret=<redacted>]";
        }
    }
}
