package com.mayday.telegram;

import com.mayday.common.exception.BusinessException;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.mapper.TelegramMediaPolicyMapper;
import com.mybatisflex.core.row.Row;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.stereotype.Service;

/**
 * Applies administrator-selected media limits without restarting or logging out
 * Telegram.
 */
@Service
@RequiredArgsConstructor
@DependsOnDatabaseInitialization
public class TelegramMediaPolicyService implements InitializingBean
{
    private static final long MAX_CAPACITY = 2L * 1024 * 1024 * 1024 * 1024;
    private final TelegramMediaPolicyMapper policies;
    private final TelegramSettings settings;
    private final AccessPolicy access;

    /**
     * Restores only explicit overrides, preserving environment defaults on a fresh
     * database.
     */
    @Override
    public void afterPropertiesSet()
    {
        refresh();
    }

    /**
     * Refreshes persisted policy before claiming a new download on any application
     * instance.
     */
    public synchronized void refresh()
    {
        Row row = policies.readPolicy();
        if (row != null && row.getLong("max_file_bytes") != null)
        {
            apply(new Policy(row.getLong("max_file_bytes"), row.getLong("max_stored_bytes"),
                    row.getInt("download_timeout_seconds")));
        }
    }

    /** Returns editable media policy to authorized administrators. */
    public synchronized Policy read()
    {
        access.require("telegram:configure");
        refresh();
        return new Policy(settings.getConfiguredMaxMediaFileBytes(), settings.getMaxStoredMediaBytes(),
                settings.getMediaDownloadTimeoutSeconds());
    }

    /**
     * Validates and persists the policy before applying it to subsequent attempts.
     */
    public synchronized Policy save(Policy policy)
    {
        access.require("telegram:configure");
        if (policy.maxFileBytes() < 0 || policy.maxFileBytes() > MAX_CAPACITY
                || policy.maxStoredBytes() < 100L * 1024 * 1024 || policy.maxStoredBytes() > MAX_CAPACITY
                || policy.maxFileBytes() > policy.maxStoredBytes() || policy.downloadTimeoutSeconds() < 30
                || policy.downloadTimeoutSeconds() > 86400)
        {
            throw new BusinessException("请填写有效的媒体容量和下载时限；单文件上限不能大于总容量，0 表示不单独限制");
        }
        policies.savePolicy(policy.maxFileBytes(), policy.maxStoredBytes(), policy.downloadTimeoutSeconds(),
                access.current().getId());
        apply(policy);
        return policy;
    }

    private void apply(Policy policy)
    {
        settings.setMaxStoredMediaBytes(policy.maxStoredBytes());
        settings.setMaxMediaFileBytes(policy.maxFileBytes());
        settings.setMediaDownloadTimeoutSeconds(policy.downloadTimeoutSeconds());
    }

    /**
     * Byte-based policy; zero disables the separate file cap, not physical storage
     * checks.
     */
    public record Policy(long maxFileBytes, long maxStoredBytes, int downloadTimeoutSeconds) {
    }
}
