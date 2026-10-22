package com.mayday.telegram;

/**
 * Public authorization states exposed by the Mayday API.
 *
 * <p>
 * Values are intentionally independent of TDLib class names, so clients and
 * persisted state do not depend on a generated JNI model.
 */
public enum TelegramAuthorizationState {
    NOT_CONNECTED, INITIALIZING, WAITING_FOR_PHONE, WAITING_FOR_CODE, WAITING_FOR_PASSWORD, WAITING_FOR_EMAIL_ADDRESS, WAITING_FOR_EMAIL_CODE, WAITING_FOR_REGISTRATION, WAITING_FOR_DEVICE_CONFIRMATION, READY, CLOSING, CLOSED, LOGGED_OUT, ERROR, UNSUPPORTED
}
