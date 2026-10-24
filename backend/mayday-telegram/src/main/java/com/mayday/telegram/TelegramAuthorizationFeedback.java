package com.mayday.telegram;

import java.io.IOException;
import java.net.SocketException;
import java.util.Locale;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

/**
 * Converts TDLib authorization failures into actionable messages that are safe
 * to show to administrators.
 *
 * <p>
 * TDLib error text can contain request-specific values. This class only matches
 * known error tokens and never returns the original text or exception message.
 */
final class TelegramAuthorizationFeedback
{
    private TelegramAuthorizationFeedback()
    {
    }

    /**
     * Maps known TDLib error tokens and HTTP-like error codes to safe guidance.
     * Unknown server messages are deliberately discarded to avoid leaking account
     * identifiers or authorization input into the UI.
     *
     * @param errorCode
     *            TDLib error code
     * @param errorMessage
     *            TDLib error text, inspected only for known tokens
     * @return a fixed, actionable message without raw server data
     */
    static String rejected(int errorCode, String errorMessage)
    {
        String normalized = errorMessage == null ? "" : errorMessage.toUpperCase(Locale.ROOT);
        if (containsAny(normalized, "PHONE_NUMBER_INVALID", "PHONE_NUMBER_M_INVALID"))
        {
            return "Telegram 判定手机号格式无效，请使用带国际区号的格式（例如 +8613800000000）后重试。";
        }
        if (containsAny(normalized, "PHONE_NUMBER_BANNED", "USER_DEACTIVATED_BAN"))
        {
            return "该 Telegram 账号或手机号受到限制，请先在 Telegram 官方客户端确认账号状态。";
        }
        if (containsAny(normalized, "PHONE_NUMBER_FLOOD", "PHONE_CODE_FLOOD", "FLOOD_WAIT") || errorCode == 420
                || errorCode == 429)
        {
            return "Telegram 暂时限制了授权请求，请等待一段时间后再试，避免连续提交。";
        }
        if (containsAny(normalized, "PHONE_CODE_INVALID", "PHONE_CODE_EXPIRED"))
        {
            return "验证码无效或已过期，请查看 Telegram 客户端中的最新验证码后重试。";
        }
        if (containsAny(normalized, "PASSWORD_HASH_INVALID"))
        {
            return "两步验证密码不正确，请核对后重试。";
        }
        if (containsAny(normalized, "EMAIL_ADDRESS_INVALID", "EMAIL_INVALID"))
        {
            return "邮箱地址格式无效，请核对后重试。";
        }
        if (containsAny(normalized, "EMAIL_CODE_INVALID", "EMAIL_CODE_EXPIRED"))
        {
            return "邮箱验证码无效或已过期，请查看最新邮件后重试。";
        }
        if (containsAny(normalized, "API_ID_INVALID", "API_HASH_INVALID", "API_ID_PUBLISHED_FLOOD"))
        {
            return "Telegram API 凭据未通过验证，请在本页配置中核对 API ID 和 API Hash。";
        }
        if (containsAny(normalized, "AUTH_KEY_UNREGISTERED", "AUTH_KEY_INVALID", "SESSION_REVOKED", "SESSION_EXPIRED"))
        {
            return "Telegram 登录会话已失效，请重新连接账号。";
        }
        return "Telegram 拒绝了本次授权请求。请核对当前步骤的输入；若输入无误，请检查 API 配置和网络代理。";
    }

    /**
     * Produces safe feedback for transport and asynchronous request failures.
     *
     * @param failure
     *            request failure, possibly wrapped by a completion stage
     * @return a fixed message that does not include exception details
     */
    static String failed(Throwable failure)
    {
        Throwable cause = unwrap(failure);
        if (cause instanceof TimeoutException)
        {
            return "等待 Telegram 响应超时，请检查服务端网络或代理设置后重试。";
        }
        if (cause instanceof IOException || cause instanceof SocketException)
        {
            return "无法连接 Telegram 服务，请检查服务端网络或代理设置后重试。";
        }
        return "与 Telegram 通信失败，请检查服务端网络或代理设置后重试。";
    }

    /**
     * Checks only allow-listed markers; the source error text is never surfaced.
     */
    private static boolean containsAny(String value, String... tokens)
    {
        for (String token : tokens)
        {
            if (value.contains(token))
            {
                return true;
            }
        }
        return false;
    }

    /**
     * Unwraps only standard future wrappers so timeout and network causes can be
     * mapped without exposing their message.
     */
    private static Throwable unwrap(Throwable failure)
    {
        Throwable cause = failure;
        while ((cause instanceof CompletionException || cause instanceof ExecutionException)
                && cause.getCause() != null)
        {
            cause = cause.getCause();
        }
        return cause;
    }
}
