package com.mayday.telegram;

import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Error guidance must describe the failure without copying sensitive provider
 * text.
 */
class TelegramCollectionFeedbackTest
{
    @Test
    void identifiesProtectedUnavailableAndTimeoutFailures()
    {
        assertThat(TelegramCollectionFeedback.failed(new IllegalArgumentException("LINK_MESSAGE_PROTECTED")))
                .contains("禁止保存");
        assertThat(TelegramCollectionFeedback.failed(new IllegalArgumentException("LINK_MESSAGE_UNAVAILABLE")))
                .contains("未返回原消息");
        assertThat(TelegramCollectionFeedback.failed(new CompletionException(new TimeoutException()))).contains("超时");
    }

    @Test
    void discardsUnknownSensitiveErrorText()
    {
        assertThat(TelegramCollectionFeedback.failed(new IllegalArgumentException("private-phone-and-request")))
                .doesNotContain("private-phone-and-request").contains("读取原消息失败");
    }
}
