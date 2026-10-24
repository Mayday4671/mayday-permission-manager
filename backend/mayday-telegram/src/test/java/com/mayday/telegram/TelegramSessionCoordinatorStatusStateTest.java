package com.mayday.telegram;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Ensures stale persisted Telegram authorization steps cannot be submitted
 * after restart.
 */
class TelegramSessionCoordinatorStatusStateTest
{
    /**
     * A persisted phone challenge is actionable only after a live client restores
     * it.
     */
    @Test
    void shouldHidePersistedPhoneChallengeUntilSessionReconnects()
    {
        assertEquals(TelegramAuthorizationState.CLOSED,
                TelegramSessionCoordinator.stateForStatus(false, TelegramAuthorizationState.WAITING_FOR_PHONE));
        assertEquals(TelegramAuthorizationState.WAITING_FOR_PHONE,
                TelegramSessionCoordinator.stateForStatus(true, TelegramAuthorizationState.WAITING_FOR_PHONE));
    }

    /**
     * A restart converts transitional states to closed but preserves terminal
     * errors.
     */
    @Test
    void shouldNormalizeOrPreserveDisconnectedStates()
    {
        assertEquals(TelegramAuthorizationState.CLOSED,
                TelegramSessionCoordinator.stateForStatus(false, TelegramAuthorizationState.INITIALIZING));
        assertEquals(TelegramAuthorizationState.CLOSED,
                TelegramSessionCoordinator.stateForStatus(false, TelegramAuthorizationState.READY));
        assertEquals(TelegramAuthorizationState.ERROR,
                TelegramSessionCoordinator.stateForStatus(false, TelegramAuthorizationState.ERROR));
        assertEquals(TelegramAuthorizationState.LOGGED_OUT,
                TelegramSessionCoordinator.stateForStatus(false, TelegramAuthorizationState.LOGGED_OUT));
    }
}
