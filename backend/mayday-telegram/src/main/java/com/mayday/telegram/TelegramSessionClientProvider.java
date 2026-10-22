package com.mayday.telegram;

import java.nio.file.Path;
import java.util.function.Consumer;

/**
 * Creates an on-demand TDLib client for the single account slot.
 *
 * <p>
 * The provider itself must remain safe to construct while the module is
 * disabled; native initialization belongs inside open().
 */
public interface TelegramSessionClientProvider
{
    /**
     * Opens the encrypted local session and reports authorization changes
     * asynchronously.
     *
     * @param sessionDirectory
     *            isolated per-account data directory
     * @param settings
     *            server-side Telegram credentials and encryption key
     * @param stateListener
     *            callback for non-secret state transitions
     * @return a live account client
     */
    TelegramSessionClient open(Path sessionDirectory, TelegramSettings settings,
            Consumer<TelegramSessionUpdate> stateListener, Consumer<TelegramMessageSnapshot> messageListener);
}
