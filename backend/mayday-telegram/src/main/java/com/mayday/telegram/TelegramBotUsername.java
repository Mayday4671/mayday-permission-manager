package com.mayday.telegram;

/** Validates and canonicalizes the single configured public bot username. */
final class TelegramBotUsername
{
    private TelegramBotUsername()
    {
    }

    /**
     * Removes an optional at-sign and rejects values outside Telegram public
     * username syntax.
     */
    static String normalize(String username)
    {
        String value = username == null ? "" : username.trim();
        if (value.startsWith("@"))
        {
            value = value.substring(1);
        }
        if (!value.matches("[A-Za-z0-9_]{5,32}"))
        {
            throw new IllegalArgumentException("Telegram 机器人用户名格式无效");
        }
        return value;
    }
}
