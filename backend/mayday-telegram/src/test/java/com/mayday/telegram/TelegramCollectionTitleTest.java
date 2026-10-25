package com.mayday.telegram;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** Covers title fallback, protected content and Unicode-safe truncation. */
class TelegramCollectionTitleTest
{
    @Test
    void usesFirstCaptionLineAndPrefersAlbumCaptionOverGeneratedFileName()
    {
        var anchor = candidate(null, "[{\"fileName\":\"photo.jpg\"}]", true);
        var album = candidate("\n  山间  日落 \n拍摄说明", "[]", true);
        assertThat(TelegramCollectionTitle.from(List.of(anchor, album))).isEqualTo("山间 日落");
    }

    @Test
    void fallsBackToFileNameAndIgnoresMalformedMetadata()
    {
        assertThat(TelegramCollectionTitle.from(List.of(candidate(null, "invalid", true),
                candidate(" ", "[{\"fileName\":\"landscape-4k.mp4\"}]", true)))).isEqualTo("landscape-4k.mp4");
    }

    @Test
    void neverUsesProtectedContentOrInventsAMissingTitle()
    {
        assertThat(TelegramCollectionTitle.from(List.of(candidate("private", "[]", false)))).isNull();
        assertThat(TelegramCollectionTitle.from(List.of(candidate(null, "[]", true)))).isNull();
    }

    @Test
    void truncatesWithoutSplittingSupplementaryCharacters()
    {
        assertThat(TelegramCollectionTitle.from(List.of(candidate("🌄".repeat(170), "[]", true))))
                .isEqualTo("🌄".repeat(160) + "…");
    }

    private TelegramCollectedMessage candidate(String text, String metadata, boolean canSave)
    {
        TelegramCollectedMessage item = new TelegramCollectedMessage();
        item.setMessageText(text);
        item.setMetadataJson(metadata);
        item.setCanBeSaved(canSave);
        return item;
    }
}
