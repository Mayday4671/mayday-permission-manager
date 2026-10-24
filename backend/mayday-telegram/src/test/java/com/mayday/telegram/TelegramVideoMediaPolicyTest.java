package com.mayday.telegram;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards preview eligibility without treating metadata as proof that the bytes
 * are playable.
 */
class TelegramVideoMediaPolicyTest
{
    @ParameterizedTest
    @CsvSource(
    {"VIDEO,video/mp4,clip.mp4", "ANIMATION,video/webm,clip.webm", "DOCUMENT,video/x-matroska,clip.mkv",
            "DOCUMENT,video/quicktime,clip.mov", "DOCUMENT,application/octet-stream,clip.MKV", "DOCUMENT,,clip.M4V"})
    void acceptsSupportedContainersInVideoAndDocumentMessages(String kind, String type, String filename)
    {
        assertThat(TelegramVideoMediaPolicy.isPreviewCandidate(media(kind, type, filename))).isTrue();
    }

    @ParameterizedTest
    @CsvSource(
    {"AUDIO,video/mp4,clip.mp4", "PHOTO,video/mp4,clip.mp4", "DOCUMENT,application/pdf,clip.mp4",
            "DOCUMENT,application/octet-stream,clip.mp4.exe", "DOCUMENT,application/octet-stream,clip.avi",
            "DOCUMENT,application/octet-stream,clip", "DOCUMENT,,clip.mp4?download=1", "DOCUMENT,,"})
    void rejectsUnrelatedKindsAndExplicitNonVideoTypes(String kind, String type, String filename)
    {
        assertThat(TelegramVideoMediaPolicy.isPreviewCandidate(media(kind, type, filename))).isFalse();
    }

    @Test
    void documentVideosRequireDocumentOptInInsteadOfVideoOptIn()
    {
        TelegramCollectionTask task = new TelegramCollectionTask();
        task.setDownloadDocuments(true);
        task.setDownloadVideos(false);
        TelegramMedia document = media("DOCUMENT", "video/mp4", "clip.mp4");
        TelegramMedia video = media("VIDEO", "video/mp4", "clip.mp4");

        assertThat(TelegramVideoMediaPolicy.isDownloadAllowed(document, task)).isTrue();
        assertThat(TelegramVideoMediaPolicy.isDownloadAllowed(video, task)).isFalse();
        task.setDownloadDocuments(false);
        task.setDownloadVideos(true);
        assertThat(TelegramVideoMediaPolicy.isDownloadAllowed(document, task)).isFalse();
        assertThat(TelegramVideoMediaPolicy.isDownloadAllowed(video, task)).isTrue();
    }

    private TelegramMedia media(String kind, String type, String filename)
    {
        TelegramMedia media = new TelegramMedia();
        media.setKind(kind);
        media.setMediaType(type);
        media.setFileName(filename);
        return media;
    }
}
