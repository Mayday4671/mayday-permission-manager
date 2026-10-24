package com.mayday.telegram;

import java.net.SocketException;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * Verifies Telegram authorization failures produce useful, non-sensitive
 * feedback.
 */
class TelegramAuthorizationFeedbackTest
{
    /**
     * Known phone failures should guide correction without exposing raw TDLib text.
     */
    @Test
    void shouldExplainInvalidPhoneAndSuppressTheOriginalError()
    {
        String result = TelegramAuthorizationFeedback.rejected(400,
                "PHONE_NUMBER_INVALID private-value +8613800000000");

        assertEquals("Telegram 判定手机号格式无效，请使用带国际区号的格式（例如 +8613800000000）后重试。", result);
        assertFalse(result.contains("private-value"));
    }

    /**
     * Flood controls should advise waiting instead of encouraging repeated retries.
     */
    @Test
    void shouldExplainTelegramRateLimits()
    {
        assertEquals("Telegram 暂时限制了授权请求，请等待一段时间后再试，避免连续提交。",
                TelegramAuthorizationFeedback.rejected(420, "FLOOD_WAIT_240"));
    }

    /**
     * Async timeout and network errors should point to server connectivity checks.
     */
    @Test
    void shouldMapTimeoutAndNetworkFailures()
    {
        assertEquals("等待 Telegram 响应超时，请检查服务端网络或代理设置后重试。",
                TelegramAuthorizationFeedback.failed(new CompletionException(new TimeoutException("secret"))));
        assertEquals("无法连接 Telegram 服务，请检查服务端网络或代理设置后重试。",
                TelegramAuthorizationFeedback.failed(new SocketException("secret")));
    }

    /**
     * Unknown TDLib messages must never appear verbatim in administrator feedback.
     */
    @Test
    void shouldNotExposeUnknownTelegramErrorText()
    {
        String result = TelegramAuthorizationFeedback.rejected(400, "unknown private account detail");

        assertFalse(result.contains("private account detail"));
        assertEquals("Telegram 拒绝了本次授权请求。请核对当前步骤的输入；若输入无误，请检查 API 配置和网络代理。", result);
    }
}
