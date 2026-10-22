package com.mayday.telegram;

/**
 * Signals that a durable collection task must wait for an operator to
 * reconnect.
 */
final class TelegramSessionUnavailableException extends RuntimeException
{
    private static final long serialVersionUID = 1L;
}
