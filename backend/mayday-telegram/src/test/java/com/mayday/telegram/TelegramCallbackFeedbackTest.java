package com.mayday.telegram;

import java.io.IOException;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeoutException;

import it.tdlight.client.TelegramError;
import it.tdlight.jni.TdApi;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Verifies callback failures are actionable while keeping raw Telegram details
 * private.
 */
class TelegramCallbackFeedbackTest
{
    /**
     * Expired or replaced keyboard callbacks should direct the user to a current
     * result.
     */
    @Test
    void shouldExplainStaleCallbackButtons()
    {
        TelegramError failure = new TelegramError(new TdApi.Error(400, "MESSAGE_ID_INVALID private detail"));

        String feedback = TelegramCallbackFeedback.failed(new CompletionException(failure));

        assertEquals("这个按钮已失效或机器人已更新结果，请重新发送关键词并使用最新回复中的按钮。", feedback);
        assertFalse(feedback.contains("private detail"));
        assertEquals("TDLIB_ERROR_400", TelegramCallbackFeedback.diagnosticLabel(failure));
    }

    /**
     * Telegram rate limits and callback timeouts should discourage repeated clicks.
     */
    @Test
    void shouldExplainRateLimitsAndTimeouts()
    {
        assertEquals("Telegram 暂时限制了按钮请求，请等待一段时间后再试。",
                TelegramCallbackFeedback.failed(new TelegramError(new TdApi.Error(420, "FLOOD_WAIT_20"))));
        assertEquals("按钮请求等待超时，Telegram 暂未返回结果。请刷新机器人回复后重试；不要连续重复点击。",
                TelegramCallbackFeedback.failed(new CompletionException(new TimeoutException("private detail"))));
    }

    /**
     * Transport failures should direct administrators to the configured connection
     * path.
     */
    @Test
    void shouldExplainNetworkErrorsWithoutExposingDetails()
    {
        String feedback = TelegramCallbackFeedback.failed(new IOException("private network detail"));

        assertEquals("连接 Telegram 失败，请检查账号连接和服务端代理后重试。", feedback);
        assertFalse(feedback.contains("private network detail"));
        assertEquals("NETWORK_ERROR", TelegramCallbackFeedback.diagnosticLabel(new IOException("secret")));
    }

    /** Unknown native errors must never disclose their free-form message. */
    @Test
    void shouldSuppressUnknownTelegramErrors()
    {
        String feedback = TelegramCallbackFeedback
                .failed(new TelegramError(new TdApi.Error(400, "unknown private account detail")));

        assertEquals("Telegram 拒绝了这个按钮请求，请重新发送关键词并使用最新回复中的按钮。", feedback);
        assertFalse(feedback.contains("private account detail"));
    }

    /** TDLib reports an unanswered callback query as a gateway timeout. */
    @Test
    void shouldExplainTelegramCallbackGatewayTimeout()
    {
        TelegramError failure = new TelegramError(new TdApi.Error(502, "private detail"));

        String feedback = TelegramCallbackFeedback.failed(failure);

        assertEquals("搜索机器人没有及时响应这个按钮，请稍后重试；不要连续重复点击。", feedback);
        assertFalse(feedback.contains("private detail"));
    }
}
