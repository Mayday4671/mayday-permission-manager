package com.mayday.telegram;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Transient Telegram authorization input.
 *
 * <p>
 * This DTO intentionally redacts its generated representation so validation
 * logs cannot print codes or passwords.
 */
public final class TelegramSensitiveValueRequest
{
    @NotBlank
    @Size(max = 512)
    private String value;

    /**
     * Returns the one-time request value to the authorization service; callers must
     * not retain it.
     */
    public String getValue()
    {
        return value;
    }

    /**
     * Binds transient input from the authenticated administrator's HTTPS request.
     */
    public void setValue(String value)
    {
        this.value = value;
    }

    /**
     * Always redacts the credential value if a framework or debugger renders this
     * request object.
     */
    @Override
    public String toString()
    {
        return "TelegramSensitiveValueRequest[value=[REDACTED]]";
    }
}
