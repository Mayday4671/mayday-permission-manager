package com.mayday.telegram;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies search failures tell the operator what Telegram actually rejected
 * instead of asking the user to repeat an already completed authorization step.
 */
class TelegramSearchFailureMessageTest
{
    @Test
    void explainsRecipientMismatchWithoutAssumingTheUserBlockedTheBot()
    {
        String message = TelegramSearchService.sendFailureMessage(400, "YOU_BLOCKED_USER");

        assertThat(message).contains("YOU_BLOCKED_USER");
        assertThat(message).contains("当前配置的机器人");
        assertThat(message).contains("与 Telegram 客户端中使用的机器人一致");
        assertThat(message).contains("无需重新登录账号");
        assertThat(message).doesNotContain("屏蔽了搜索机器人");
        assertThat(message).doesNotContain("手机端对话已成功收到回复");
    }

    @Test
    void keepsRateLimitFeedbackActionable()
    {
        assertThat(TelegramSearchService.sendFailureMessage(429, null)).contains("发送频率");
    }
}
