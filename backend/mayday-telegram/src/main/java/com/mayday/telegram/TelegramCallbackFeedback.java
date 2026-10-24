package com.mayday.telegram;

import java.io.IOException;
import java.net.SocketException;
import java.util.Locale;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

import it.tdlight.client.TelegramError;

/**
 * Converts Telegram inline-button failures into actionable, non-sensitive
 * feedback for the authenticated Mayday user.
 *
 * <p>
 * Telegram error text may contain request context, so only known markers are
 * inspected. Raw messages, callback bytes, and exception details are never
 * returned to the browser or written to application logs.
 */
final class TelegramCallbackFeedback
{
    private TelegramCallbackFeedback()
    {
    }

    /**
     * Maps a failed TDLib callback request to a safe message that explains the next
     * useful action.
     *
     * @param failure
     *            asynchronous failure from the TDLib request
     * @return user-facing guidance without the raw Telegram error
     */
    static String failed(Throwable failure)
    {
        Throwable cause = unwrap(failure);
        if (cause instanceof TelegramError telegramError)
        {
            return rejected(telegramError.getErrorCode(), telegramError.getErrorMessage());
        }
        if (cause instanceof TimeoutException)
        {
            return "按钮请求等待超时，Telegram 暂未返回结果。请刷新机器人回复后重试；不要连续重复点击。";
        }
        if (cause instanceof CancellationException)
        {
            return "Telegram 连接已关闭，请重新连接账号后刷新机器人回复。";
        }
        if (cause instanceof IOException || cause instanceof SocketException)
        {
            return "连接 Telegram 失败，请检查账号连接和服务端代理后重试。";
        }
        return "Telegram 未能处理这个按钮，请刷新机器人回复后再试。";
    }

    /**
     * Returns a restricted diagnostic token suitable for server logs. The token
     * never contains Telegram's free-form error message or callback data.
     *
     * @param failure
     *            asynchronous failure from the TDLib request
     * @return a fixed category or numeric TDLib error code
     */
    static String diagnosticLabel(Throwable failure)
    {
        Throwable cause = unwrap(failure);
        if (cause instanceof TelegramError telegramError)
        {
            return "TDLIB_ERROR_" + telegramError.getErrorCode();
        }
        if (cause instanceof TimeoutException)
        {
            return "TIMEOUT";
        }
        if (cause instanceof CancellationException)
        {
            return "REQUEST_CANCELLED";
        }
        if (cause instanceof IOException || cause instanceof SocketException)
        {
            return "NETWORK_ERROR";
        }
        return cause.getClass().getSimpleName();
    }

    /**
     * Maps only allow-listed Telegram error markers; free-form text is never
     * surfaced.
     */
    private static String rejected(int errorCode, String errorMessage)
    {
        String normalized = errorMessage == null ? "" : errorMessage.toUpperCase(Locale.ROOT);
        if (containsAny(normalized, "MESSAGE_ID_INVALID", "MESSAGE_ID_NOT_FOUND", "BUTTON_DATA_INVALID",
                "QUERY_ID_INVALID", "QUERY_ID_EXPIRED"))
        {
            return "这个按钮已失效或机器人已更新结果，请重新发送关键词并使用最新回复中的按钮。";
        }
        if (containsAny(normalized, "BOT_RESPONSE_TIMEOUT", "QUERY_TIMEOUT") || errorCode == 502)
        {
            return "搜索机器人没有及时响应这个按钮，请稍后重试；不要连续重复点击。";
        }
        if (containsAny(normalized, "USER_IS_BLOCKED", "BOT_BLOCKED", "YOU_BLOCKED_USER"))
        {
            return "当前 Telegram 账号无法联系搜索机器人，请在 Telegram 客户端检查机器人对话状态。";
        }
        if (containsAny(normalized, "FLOOD_WAIT", "CALLBACK_QUERY_TOO_MUCH") || errorCode == 420 || errorCode == 429)
        {
            return "Telegram 暂时限制了按钮请求，请等待一段时间后再试。";
        }
        return "Telegram 拒绝了这个按钮请求，请重新发送关键词并使用最新回复中的按钮。";
    }

    /**
     * Checks only approved error markers, without returning the source string.
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
     * Removes standard future wrappers so diagnostics reflect the TDLib cause.
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
