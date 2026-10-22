package com.mayday.telegram;

/** Validated single HTTP byte range for a stored Telegram media object. */
record TelegramByteRange(long start, long end, long total) {
    /**
     * Parses one RFC 9110 byte range; multi-range and malformed inputs are
     * intentionally unsupported.
     */
    static TelegramByteRange parse(String value, long total)
    {
        if (value == null || total < 1 || !value.startsWith("bytes=") || value.indexOf(',') >= 0)
        {
            return null;
        }
        String[] parts = value.substring(6).split("-", -1);
        if (parts.length != 2)
        {
            return null;
        }
        try
        {
            if ((!parts[0].isEmpty() && !parts[0].matches("[0-9]+"))
                    || (!parts[1].isEmpty() && !parts[1].matches("[0-9]+")))
            {
                return null;
            }
            long start;
            long end;
            if (parts[0].isEmpty())
            {
                long suffix = Long.parseLong(parts[1]);
                if (suffix < 1)
                {
                    return null;
                }
                start = Math.max(0, total - suffix);
                end = total - 1;
            } else
            {
                start = Long.parseLong(parts[0]);
                end = parts[1].isEmpty() ? total - 1 : Long.parseLong(parts[1]);
                if (start < 0 || start >= total || end < start)
                {
                    return null;
                }
                end = Math.min(end, total - 1);
            }
            return new TelegramByteRange(start, end, total);
        } catch (NumberFormatException exception)
        {
            return null;
        }
    }
}
