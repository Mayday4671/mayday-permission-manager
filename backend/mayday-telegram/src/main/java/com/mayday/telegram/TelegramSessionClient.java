package com.mayday.telegram;

import java.util.concurrent.CompletableFuture;

/**
 * Minimal asynchronous client boundary used by the account lifecycle service.
 *
 * <p>
 * TDLib callbacks arrive on its update thread; UI requests are submitted as
 * one-way functions and completion is reflected through the authorization-state
 * listener rather than held open in HTTP requests.
 */
public interface TelegramSessionClient
{
    /**
     * Resolves and verifies the configured public bot before any search text is
     * sent.
     */
    CompletableFuture<TelegramBotChat> resolveBot(String username);

    /**
     * Searches only channels already visible in the authorized user's Telegram chat
     * list.
     */
    CompletableFuture<java.util.List<TelegramChannelOption>> searchChannels(String query, int limit);

    /**
     * Resolves an ID again and confirms that it is an accessible channel before a
     * task is created.
     */
    CompletableFuture<TelegramChannelOption> resolveChannel(String chatId);

    /**
     * Sends a user-requested search string only to the previously verified bot
     * chat.
     */
    CompletableFuture<String> sendSearchText(String chatId, String query);

    /**
     * Activates a callback button from a verified message in the configured bot
     * chat. Callback data must be resolved from a stored Telegram message by the
     * business service, never accepted directly from the browser.
     */
    CompletableFuture<TelegramCallbackAnswer> activateCallback(String chatId, String messageId, byte[] callbackData);

    /** Resolves an accessible public/private Telegram message URL through TDLib. */
    CompletableFuture<TelegramMessageLink> resolveMessageLink(String messageLink);

    /**
     * Reads one bounded page of history at or before the supplied message cursor.
     */
    CompletableFuture<java.util.List<TelegramMessageSnapshot>> getChatHistory(String chatId, String fromMessageId,
            int limit);

    /**
     * Reads a bounded page newer than a separate live checkpoint without joining
     * the chat.
     */
    CompletableFuture<java.util.List<TelegramMessageSnapshot>> getNewerChatHistory(String chatId, String fromMessageId,
            int limit);

    /** Downloads one TDLib file into the session's private files directory. */
    CompletableFuture<TelegramDownloadedFile> downloadFile(int fileId, long maxBytes);

    /** Cancels an in-progress TDLib file transfer after its configured deadline. */
    void cancelDownloadFile(int fileId);

    /**
     * Submits the phone number supplied by the current authenticated Mayday user.
     */
    void submitPhoneNumber(String phoneNumber);

    /** Submits a one-time Telegram login code without persisting it. */
    void submitCode(String code);

    /**
     * Submits the Telegram two-step verification password without persisting it.
     */
    void submitPassword(String password);

    /** Submits an email address if Telegram requires email-based authentication. */
    void submitEmailAddress(String emailAddress);

    /** Submits an email login code without persisting it. */
    void submitEmailCode(String code);

    /**
     * Completes the account registration step when Telegram requires a new profile.
     */
    void register(String firstName, String lastName);

    /**
     * Explicitly logs out the Telegram account and destroys its reusable
     * authorization session.
     */
    void logOut();

    /**
     * Closes the local TDLib client while preserving its authorized session
     * database.
     */
    void close();
}
