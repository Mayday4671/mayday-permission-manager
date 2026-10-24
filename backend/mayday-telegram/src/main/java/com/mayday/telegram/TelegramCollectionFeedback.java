package com.mayday.telegram;

import java.util.Locale;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

import it.tdlight.client.TelegramError;

/**
 * Maps collection errors to fixed guidance without exposing Telegram request
 * data.
 */
final class TelegramCollectionFeedback
{
    private TelegramCollectionFeedback()
    {
    }

    /**
     * Distinguishes inaccessible media from rate limits, timeouts and protected
     * messages.
     */
    static String failed(Throwable failure)
    {
        Throwable cause = failure;
        while ((cause instanceof CompletionException || cause instanceof ExecutionException)
                && cause.getCause() != null)
        {
            cause = cause.getCause();
        }
        if (cause instanceof TimeoutException)
        {
            return "读取原消息超时，请检查 Telegram 连接与代理后重试；不要连续点击";
        }
        if ("LINK_MESSAGE_PROTECTED".equals(cause.getMessage()))
        {
            return "原消息禁止保存媒体，无法在此下载预览，请在 Telegram 中查看";
        }
        if ("LINK_MESSAGE_UNAVAILABLE".equals(cause.getMessage()))
        {
            return "Telegram 未返回原消息，它可能已删除或当前账号无权访问";
        }
        if (cause instanceof TelegramError error)
        {
            String name = error.getErrorMessage() == null ? "" : error.getErrorMessage().toUpperCase(Locale.ROOT);
            if (error.getErrorCode() == 420 || error.getErrorCode() == 429 || name.contains("FLOOD_WAIT"))
            {
                return "Telegram 暂时限制了读取请求，请稍后重试，避免连续点击";
            }
            if (name.contains("MESSAGE_ID_INVALID") || name.contains("MESSAGE_NOT_FOUND"))
            {
                return "原消息不存在或已删除，请核对消息链接";
            }
            if (name.contains("CHANNEL_PRIVATE") || name.contains("CHAT_ACCESS_DENIED"))
            {
                return "当前 Telegram 账号无权访问该来源，请在 Telegram 中检查访问权限";
            }
            return "Telegram 拒绝读取原消息（错误代码 " + error.getErrorCode() + "），请核对来源和账号连接";
        }
        return "读取原消息失败，请检查 Telegram 连接后重试";
    }
}
