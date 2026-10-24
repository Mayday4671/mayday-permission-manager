package com.mayday.telegram;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies that a conversation response carries each parsed link beside the
 * exact Telegram message that produced it, without returning account metadata.
 */
class TelegramConversationMessageViewTest
{
    private final TelegramResultParser parser = new TelegramResultParser(new ObjectMapper());

    @Test
    void attachesSourceLinksToTheirOriginatingBotMessage()
    {
        TelegramSearchMessage entity = new TelegramSearchMessage();
        entity.setId(81L);
        entity.setOwnerId(24L);
        entity.setDepartmentId(6L);
        entity.setBotChatId("-100987654321");
        entity.setTelegramMessageId("1024");
        entity.setContentType("MessageText");
        entity.setMessageText("查到频道：https://t.me/mayday_updates/32");
        entity.setEntitiesJson("[]");
        entity.setReplyMarkupJson("[]");
        entity.setAssociationStatus("MATCHED");

        TelegramSearchContracts.ConversationMessageView view = TelegramSearchContracts.ConversationMessageView
                .from(entity, parser);

        assertThat(view.id()).isEqualTo(81L);
        assertThat(view.messageText()).isEqualTo(entity.getMessageText());
        assertThat(view.sourceLinks()).singleElement().satisfies(link -> {
            assertThat(link.sourceMessageId()).isEqualTo(view.id());
            assertThat(link.url()).isEqualTo("https://t.me/mayday_updates/32");
            assertThat(link.publicChat()).isEqualTo("mayday_updates");
        });
        assertThat(view.toString()).doesNotContain(entity.getBotChatId()).doesNotContain("ownerId")
                .doesNotContain("departmentId");
    }

    @Test
    void exposesVisibleTelegramTextUrlRangesIncludingUtf16Offsets()
    {
        TelegramSearchMessage entity = new TelegramSearchMessage();
        entity.setId(82L);
        entity.setContentType("MessageText");
        entity.setMessageText("📱 iPhone 18");
        entity.setEntitiesJson("[{\"offset\":3,\"length\":9,\"type\":\"TextEntityTypeTextUrl\","
                + "\"url\":\"https://example.com/iphone\"}]");
        entity.setReplyMarkupJson("[]");

        TelegramSearchContracts.ConversationMessageView view = TelegramSearchContracts.ConversationMessageView
                .from(entity, parser);

        assertThat(view.messageText()).isEqualTo("📱 iPhone 18");
        assertThat(view.inlineLinks()).singleElement().satisfies(link -> {
            assertThat(link.offset()).isEqualTo(3);
            assertThat(link.length()).isEqualTo(9);
            assertThat(link.url()).isEqualTo("https://example.com/iphone");
        });
    }

    @Test
    void linksVisibleUrlsWithoutDroppingSurroundingText()
    {
        TelegramSearchMessage entity = new TelegramSearchMessage();
        entity.setId(83L);
        entity.setContentType("MessageText");
        entity.setMessageText("详情：https://example.com/item。请查看");
        entity.setEntitiesJson("[]");
        entity.setReplyMarkupJson("[]");

        TelegramSearchContracts.ConversationMessageView view = TelegramSearchContracts.ConversationMessageView
                .from(entity, parser);

        assertThat(view.messageText()).isEqualTo("详情：https://example.com/item。请查看");
        assertThat(view.inlineLinks()).singleElement().satisfies(link -> {
            assertThat(view.messageText().substring(link.offset(), link.offset() + link.length()))
                    .isEqualTo(link.url());
            assertThat(link.url()).isEqualTo("https://example.com/item");
        });
    }
}
