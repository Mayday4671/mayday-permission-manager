package com.mayday.telegram;

import java.util.List;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

/** Tests conservative, bounded parsing of unknown bot response formats. */
class TelegramResultParserTest
{
    private final TelegramResultParser parser = new TelegramResultParser(new ObjectMapper());

    @Test
    void classifiesPublicTelegramMessageAndExternalLinksWithoutGuessingTitles()
    {
        TelegramSearchMessage message = message("结果：https://t.me/example_channel/123；镜像 https://example.com/item?id=3");

        List<TelegramResultParser.SourceLink> links = parser.parse(message);

        assertThat(links).hasSize(2);
        assertThat(links.get(0).sourceType()).isEqualTo("TELEGRAM_MESSAGE");
        assertThat(links.get(0).publicChat()).isEqualTo("example_channel");
        assertThat(links.get(1).sourceType()).isEqualTo("EXTERNAL_LINK");
        assertThat(links.get(1).publicChat()).isNull();
    }

    @Test
    void ignoresCredentialsMalformedUrlsAndDuplicateLinks()
    {
        TelegramSearchMessage message = message(
                "https://user:pass@example.com/private https://t.me/example_channel/9 https://t.me/example_channel/9 http://[broken");

        assertThat(parser.parse(message)).hasSize(1);
    }

    @Test
    void extractsHiddenTextUrlEntityDestinations()
    {
        TelegramSearchMessage message = message("Open the result");
        message.setEntitiesJson("[{\"type\":\"TextUrl\",\"url\":\"https://t.me/entity_channel/12\"}]");

        assertThat(parser.parse(message)).singleElement().satisfies(link -> {
            assertThat(link.sourceType()).isEqualTo("TELEGRAM_MESSAGE");
            assertThat(link.publicChat()).isEqualTo("entity_channel");
        });
    }

    @Test
    void emptyAndOverLimitTextAreSafe()
    {
        assertThat(parser.parse(message("  "))).isEmpty();
        String text = java.util.stream.IntStream.range(0, 110).mapToObj(index -> "https://example.com/" + index)
                .collect(java.util.stream.Collectors.joining(" "));

        assertThat(parser.parse(message(text))).hasSize(100);
    }

    private TelegramSearchMessage message(String text)
    {
        TelegramSearchMessage message = new TelegramSearchMessage();
        message.setId(7L);
        message.setMessageText(text);
        message.setEntitiesJson("[]");
        return message;
    }
}
