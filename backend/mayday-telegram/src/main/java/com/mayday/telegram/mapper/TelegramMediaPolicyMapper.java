package com.mayday.telegram.mapper;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import org.apache.ibatis.annotations.Mapper;

/**
 * Persists non-secret media limits independently of the Telegram account
 * connection.
 */
@Mapper
public interface TelegramMediaPolicyMapper
{
    /** Reads the singleton policy; null fields retain deployment defaults. */
    default Row readPolicy()
    {
        return Db.selectOneBySql(
                "SELECT max_file_bytes, max_stored_bytes, download_timeout_seconds FROM sys_telegram_media_policy WHERE id = 1");
    }

    /**
     * Saves validated limits without disconnecting the account or modifying
     * credentials.
     */
    default void savePolicy(long fileBytes, long storedBytes, int timeoutSeconds, Long operator)
    {
        Db.updateBySql(
                "UPDATE sys_telegram_media_policy SET max_file_bytes = ?, max_stored_bytes = ?, "
                        + "download_timeout_seconds = ?, updated_by = ?, updated_at = now(6) WHERE id = 1",
                fileBytes, storedBytes, timeoutSeconds, operator);
    }
}
