package com.mayday.telegram.mapper;

import java.util.List;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import org.apache.ibatis.annotations.Mapper;

/**
 * SQL boundary for the single administrator-managed Telegram runtime
 * configuration row.
 */
@Mapper
public interface TelegramConfigurationMapper
{
    /**
     * Reads only the singleton row; secret fields remain encrypted until the
     * service explicitly decrypts them.
     */
    default List<Row> selectStored()
    {
        return Db.selectListBySql("select api_id, api_hash_cipher, session_encryption_key_cipher, proxy_enabled, "
                + "proxy_type, proxy_host, proxy_port, proxy_username, proxy_password_cipher, proxy_secret_cipher "
                + "from sys_telegram_config where id = 1");
    }

    /**
     * Atomically replaces the singleton configuration and records the current
     * administrator as its editor.
     */
    default void upsert(String apiId, String apiHashCipher, String sessionKeyCipher, boolean proxyEnabled,
            String proxyType, String proxyHost, int proxyPort, String proxyUsername, String proxyPasswordCipher,
            String proxySecretCipher, Long updatedBy)
    {
        Db.updateBySql("insert into sys_telegram_config (id, api_id, api_hash_cipher, session_encryption_key_cipher, "
                + "proxy_enabled, proxy_type, proxy_host, proxy_port, proxy_username, proxy_password_cipher, "
                + "proxy_secret_cipher, updated_by, created_at, updated_at) "
                + "values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(6), now(6)) "
                + "on duplicate key update api_id = values(api_id), api_hash_cipher = values(api_hash_cipher), "
                + "session_encryption_key_cipher = values(session_encryption_key_cipher), "
                + "proxy_enabled = values(proxy_enabled), proxy_type = values(proxy_type), "
                + "proxy_host = values(proxy_host), proxy_port = values(proxy_port), "
                + "proxy_username = values(proxy_username), proxy_password_cipher = values(proxy_password_cipher), "
                + "proxy_secret_cipher = values(proxy_secret_cipher), updated_by = values(updated_by), "
                + "updated_at = values(updated_at)", apiId, apiHashCipher, sessionKeyCipher, proxyEnabled, proxyType,
                proxyHost, proxyPort, proxyUsername, proxyPasswordCipher, proxySecretCipher, updatedBy);
    }
}
