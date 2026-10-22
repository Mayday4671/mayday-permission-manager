package com.mayday.telegram;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies the URL parser blocks non-Telegram destinations and authority
 * tricks.
 */
class TelegramMessageLinkValidatorTest
{
    @Test
    void acceptsOnlyHttpsLinksOnThePublicTelegramLinkHosts()
    {
        assertThat(TelegramMessageLinkValidator.validate("https://t.me/channel_name/123"))
                .isEqualTo("https://t.me/channel_name/123");
        assertThat(TelegramMessageLinkValidator.validate("https://telegram.me/c/123456/789"))
                .isEqualTo("https://telegram.me/c/123456/789");
    }

    @Test
    void rejectsOtherSchemesHostsCredentialsAndFragments()
    {
        for (String value : new String[]
        {"http://t.me/channel/1", "https://t.me.evil.example/channel/1", "https://user@t.me/channel/1",
                "https://t.me/channel/1#fragment", "https://example.com/a"})
        {
            assertThatThrownBy(() -> TelegramMessageLinkValidator.validate(value))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }
}
