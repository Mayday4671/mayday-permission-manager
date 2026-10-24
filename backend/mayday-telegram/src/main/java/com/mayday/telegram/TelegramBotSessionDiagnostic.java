package com.mayday.telegram;

/**
 * Safe, read-only identity and block-state details for the configured search
 * bot.
 *
 * <p>
 * The values identify Telegram peers but contain no credentials, authorization
 * codes, phone numbers or message text.
 *
 * @param telegramUserId
 *            Telegram user ID returned by the active TDLib session
 * @param botUsername
 *            normalized username resolved from the deployment setting
 * @param botUserId
 *            Telegram user ID of the verified bot
 * @param botChatId
 *            private-chat ID resolved for the verified bot
 * @param cachedBlockListType
 *            cached TDLib block-list type attached to the bot chat, or NONE;
 *            GetChat is an offline lookup for user accounts
 * @param onlineMainBlockListStatus
 *            whether the online main block list contains the bot, or INCOMPLETE
 *            when a bounded scan cannot reach the end of the list
 */
public record TelegramBotSessionDiagnostic(String telegramUserId, String botUsername, String botUserId,
        String botChatId, String cachedBlockListType, String onlineMainBlockListStatus) {
}
