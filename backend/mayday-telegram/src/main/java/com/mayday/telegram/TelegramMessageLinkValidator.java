package com.mayday.telegram;

import java.net.URI;

/**
 * Validates the allowed Telegram message URL shape before TDLib resolves
 * access.
 */
final class TelegramMessageLinkValidator
{
    private TelegramMessageLinkValidator()
    {
    }

    /**
     * Accepts HTTPS links on Telegram's public link hosts and rejects authority or
     * path tricks. This check does not infer private chat IDs; TDLib resolves them.
     */
    static String validate(String value)
    {
        try
        {
            URI uri = URI.create(value.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getUserInfo() != null
                    || uri.getFragment() != null || uri.getPort() != -1
                    || !(host.equalsIgnoreCase("t.me") || host.equalsIgnoreCase("telegram.me")) || uri.getPath() == null
                    || !uri.getPath().matches("/[A-Za-z0-9_/-]{1,200}"))
            {
                throw new IllegalArgumentException();
            }
            return uri.toASCIIString();
        } catch (IllegalArgumentException exception)
        {
            throw new IllegalArgumentException("请输入有效的 Telegram 消息链接（t.me 或 telegram.me）");
        }
    }
}
