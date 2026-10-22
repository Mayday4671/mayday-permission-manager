package com.mayday.telegram;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * E.164 phone challenge input; its string representation always redacts the
 * full number.
 */
public final class TelegramPhoneRequest
{
    @NotBlank
    @Pattern(regexp = "^\\+[1-9][0-9]{5,14}$")
    private String value;

    /**
     * Returns the phone number for the active authorization attempt; callers must
     * not persist it.
     */
    public String getValue()
    {
        return value;
    }

    /**
     * Binds the international phone number supplied for the active login challenge.
     */
    public void setValue(String value)
    {
        this.value = value;
    }

    /** Prevents framework diagnostics from printing a phone number. */
    @Override
    public String toString()
    {
        return "TelegramPhoneRequest[value=[REDACTED]]";
    }
}
