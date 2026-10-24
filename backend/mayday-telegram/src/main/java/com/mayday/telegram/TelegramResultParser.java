package com.mayday.telegram;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Extracts conservative source-link candidates and exact clickable text ranges
 * from captured bot messages.
 *
 * <p>
 * The bot has no published result schema in this integration. This parser
 * therefore keeps original text intact, projects only safe Telegram link
 * entities, and reports source links with their original message instead of
 * inventing titles, channels, media types, or download locations.
 */
@Component
public class TelegramResultParser
{
    private static final int MAX_LINKS_PER_MESSAGE = 100;
    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s<>\\\"'，。；：！？、）】》]{1,2048}");
    private static final Pattern TELEGRAM_PATH_PATTERN = Pattern.compile("^/(?:s/)?([A-Za-z0-9_]{5,})");

    private final ObjectMapper objectMapper;

    /**
     * Uses the application's Jackson 3 mapper to inspect saved entity projections.
     */
    public TelegramResultParser(ObjectMapper objectMapper)
    {
        this.objectMapper = objectMapper;
    }

    /**
     * Parses one persisted message snapshot into bounded source-link candidates.
     *
     * @param message
     *            captured message in the verified bot conversation
     * @return candidates in their original textual order
     */
    public List<SourceLink> parse(TelegramSearchMessage message)
    {
        String text = message.getMessageText();
        if (text == null || text.isBlank())
        {
            return List.of();
        }
        Set<String> unique = new LinkedHashSet<>();
        Matcher matcher = URL_PATTERN.matcher(text);
        while (matcher.find() && unique.size() < MAX_LINKS_PER_MESSAGE)
        {
            String candidate = trimPunctuation(matcher.group());
            unique.add(candidate);
        }
        extractEntityUrls(message.getEntitiesJson(), unique);
        List<SourceLink> results = new ArrayList<>();
        for (String candidate : unique)
        {
            SourceLink link = classify(candidate, message.getId());
            if (link != null && results.size() < MAX_LINKS_PER_MESSAGE)
            {
                results.add(link);
            }
        }
        return List.copyOf(results);
    }

    /**
     * Projects Telegram's clickable text ranges without returning its raw entity
     * JSON. Offsets use Java string indices, which match TDLib's UTF-16 offsets.
     *
     * @param message
     *            captured message in the verified bot conversation
     * @return safe HTTP(S) links paired with their visible text ranges
     */
    public List<InlineTextLink> inlineLinks(TelegramSearchMessage message)
    {
        String text = message.getMessageText();
        if (text == null || text.isBlank())
        {
            return List.of();
        }

        java.util.Map<String, InlineTextLink> linksByRange = new java.util.LinkedHashMap<>();
        Matcher matcher = URL_PATTERN.matcher(text);
        while (matcher.find() && linksByRange.size() < MAX_LINKS_PER_MESSAGE)
        {
            String visibleUrl = trimPunctuation(matcher.group());
            if (isSafeWebUrl(visibleUrl))
            {
                int length = visibleUrl.length();
                addInlineLink(linksByRange, matcher.start(), length, visibleUrl);
            }
        }

        extractEntityLinks(message.getEntitiesJson(), text, linksByRange);
        return linksByRange.values().stream().sorted(java.util.Comparator.comparingInt(InlineTextLink::offset))
                .toList();
    }

    /**
     * Converts only link-bearing Telegram entities into safe visible text ranges.
     * Formatting entities are intentionally omitted because the conversation view
     * keeps the original plain text unchanged.
     */
    private void extractEntityLinks(String entitiesJson, String messageText,
            java.util.Map<String, InlineTextLink> linksByRange)
    {
        if (entitiesJson == null || entitiesJson.isBlank() || linksByRange.size() >= MAX_LINKS_PER_MESSAGE)
        {
            return;
        }
        try
        {
            JsonNode entities = objectMapper.readTree(entitiesJson);
            if (entities == null || !entities.isArray())
            {
                return;
            }
            for (JsonNode entity : entities)
            {
                JsonNode offsetNode = entity.get("offset");
                JsonNode lengthNode = entity.get("length");
                JsonNode typeNode = entity.get("type");
                if (offsetNode == null || !offsetNode.isIntegralNumber() || lengthNode == null
                        || !lengthNode.isIntegralNumber() || typeNode == null || !typeNode.isString())
                {
                    continue;
                }

                int offset = offsetNode.intValue();
                int length = lengthNode.intValue();
                long end = (long) offset + length;
                if (offset < 0 || length <= 0 || end > messageText.length())
                {
                    continue;
                }

                String type = typeNode.stringValue();
                if (!type.endsWith("TextUrl") && !type.endsWith("Url"))
                {
                    continue;
                }

                String visibleText = messageText.substring(offset, (int) end);
                String targetUrl = type.endsWith("TextUrl") ? stringValue(entity.get("url")) : visibleText;
                if (isSafeWebUrl(targetUrl))
                {
                    addInlineLink(linksByRange, offset, length, targetUrl);
                }
                if (linksByRange.size() >= MAX_LINKS_PER_MESSAGE)
                {
                    return;
                }
            }
        } catch (JacksonException exception)
        {
            // A malformed legacy projection must not make the original message unreadable.
        }
    }

    /**
     * Adds one bounded range while letting TDLib's entity target replace a URL
     * fallback.
     */
    private void addInlineLink(java.util.Map<String, InlineTextLink> linksByRange, int offset, int length, String url)
    {
        String key = offset + ":" + length;
        linksByRange.put(key, new InlineTextLink(offset, length, url));
    }

    /**
     * Reads a string property without exposing or coercing non-string JSON values.
     */
    private String stringValue(JsonNode value)
    {
        return value != null && value.isString() ? value.stringValue() : null;
    }

    /** Allows only absolute HTTP(S) URLs without embedded credentials. */
    private boolean isSafeWebUrl(String value)
    {
        if (value == null || value.length() > 2048)
        {
            return false;
        }
        try
        {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            return uri.getHost() != null && uri.getUserInfo() == null && scheme != null
                    && ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme));
        } catch (IllegalArgumentException exception)
        {
            return false;
        }
    }

    /**
     * Adds hidden text-URL entity destinations without trusting their JSON shape.
     */
    private void extractEntityUrls(String entitiesJson, Set<String> unique)
    {
        if (entitiesJson == null || entitiesJson.isBlank() || unique.size() >= MAX_LINKS_PER_MESSAGE)
        {
            return;
        }
        try
        {
            JsonNode entities = objectMapper.readTree(entitiesJson);
            if (entities == null || !entities.isArray())
            {
                return;
            }
            for (JsonNode entity : entities)
            {
                JsonNode url = entity.get("url");
                if (url != null && url.isString() && url.stringValue().length() <= 2048)
                {
                    unique.add(url.stringValue());
                }
                if (unique.size() >= MAX_LINKS_PER_MESSAGE)
                {
                    return;
                }
            }
        } catch (JacksonException exception)
        {
            // A malformed legacy projection does not make a persisted message unreadable.
        }
    }

    /**
     * Rejects malformed URLs and credentials, then recognizes only public Telegram
     * message links as Telegram sources. Other HTTPS/HTTP links remain external.
     */
    private SourceLink classify(String value, Long messageId)
    {
        try
        {
            URI uri = URI.create(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || uri.getUserInfo() != null || uri.getFragment() != null)
            {
                return null;
            }
            String normalizedHost = host.toLowerCase(java.util.Locale.ROOT);
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme))
            {
                return null;
            }
            boolean telegramHost = normalizedHost.equals("t.me") || normalizedHost.equals("telegram.me");
            Matcher path = TELEGRAM_PATH_PATTERN.matcher(uri.getPath() == null ? "" : uri.getPath());
            String sourceType = telegramHost && path.find() ? "TELEGRAM_MESSAGE" : "EXTERNAL_LINK";
            return new SourceLink(messageId, value, normalizedHost, sourceType,
                    "TELEGRAM_MESSAGE".equals(sourceType) ? path.group(1) : null);
        } catch (IllegalArgumentException exception)
        {
            return null;
        }
    }

    /** Removes common sentence punctuation without modifying URL query values. */
    private String trimPunctuation(String value)
    {
        int end = value.length();
        while (end > 0 && ".,;:!?)]}，。；：！？）】》".indexOf(value.charAt(end - 1)) >= 0)
        {
            end--;
        }
        return value.substring(0, end);
    }

    /**
     * Explicit system interpretation, kept separate from Telegram's event fields.
     */
    public record SourceLink(Long sourceMessageId, String url, String host, String sourceType, String publicChat) {
    }

    /**
     * A clickable URL paired with the exact visible UTF-16 range in its message.
     */
    public record InlineTextLink(int offset, int length, String url) {
    }
}
