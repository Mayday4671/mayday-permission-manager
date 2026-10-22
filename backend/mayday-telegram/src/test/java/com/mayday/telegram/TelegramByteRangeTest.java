package com.mayday.telegram;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Checks valid browser range forms and rejects unsatisfiable or ambiguous
 * requests.
 */
class TelegramByteRangeTest
{
    @Test
    void acceptsClosedOpenEndedAndSuffixRanges()
    {
        assertThat(TelegramByteRange.parse("bytes=2-5", 10)).isEqualTo(new TelegramByteRange(2, 5, 10));
        assertThat(TelegramByteRange.parse("bytes=7-", 10)).isEqualTo(new TelegramByteRange(7, 9, 10));
        assertThat(TelegramByteRange.parse("bytes=-4", 10)).isEqualTo(new TelegramByteRange(6, 9, 10));
        assertThat(TelegramByteRange.parse("bytes=-40", 10)).isEqualTo(new TelegramByteRange(0, 9, 10));
        assertThat(TelegramByteRange.parse("bytes=8-40", 10)).isEqualTo(new TelegramByteRange(8, 9, 10));
    }

    @Test
    void rejectsUnsatisfiableMalformedAndMultipleRanges()
    {
        assertThat(TelegramByteRange.parse("bytes=10-", 10)).isNull();
        assertThat(TelegramByteRange.parse("bytes=5-4", 10)).isNull();
        assertThat(TelegramByteRange.parse("bytes=-0", 10)).isNull();
        assertThat(TelegramByteRange.parse("bytes=1-2,4-5", 10)).isNull();
        assertThat(TelegramByteRange.parse("items=1-2", 10)).isNull();
        assertThat(TelegramByteRange.parse("bytes=bad", 10)).isNull();
    }
}
