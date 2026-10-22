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
 * Extracts verifiable link candidates from captured bot-message text.
 *
 * <p>
 * The bot has no published result schema in this integration. This parser
 * therefore reports source links with their original message instead of
 * inventing titles, channels, media types, or download locations.
 */
@Component
public class TelegramResultParser
{
    private static final int MAX_LINKS_PER_MESSAGE = 100;
    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s<>\\\"']{1,2048}");
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
}
