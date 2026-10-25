package com.mayday.telegram;

import it.tdlight.jni.TdApi;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies small-media selection, projection redaction and strict raster
 * responses.
 */
class TelegramChannelThumbnailTest
{
    @Test
    void selectsSmallPhotoWithoutDownloadingItsLargeOriginal()
    {
        var photo = new TdApi.MessagePhoto();
        photo.photo = new TdApi.Photo();
        photo.photo.sizes = new TdApi.PhotoSize[]
        {size(1, 80, 2000), size(2, 480, 12000), size(3, 4096, 9000000)};
        assertThat(TelegramChannelThumbnail.fileFor(photo).id).isEqualTo(2);
    }

    @Test
    void videoUsesItsPosterEvenWhenOriginalIsSeveralGigabytes()
    {
        var video = new TdApi.MessageVideo();
        video.video = new TdApi.Video();
        video.video.video = new TdApi.File(50, 5_000_000_000L, 5_000_000_000L, null, null);
        video.video.thumbnail = new TdApi.Thumbnail(new TdApi.ThumbnailFormatJpeg(), 320, 180,
                new TdApi.File(51, 14000, 14000, null, null));
        assertThat(TelegramChannelThumbnail.fileFor(video).id).isEqualTo(51);
        video.video.thumbnail = null;
        assertThat(TelegramChannelThumbnail.fileFor(video)).isNull();
        assertThat(TelegramChannelThumbnail.available(video)).isFalse();
    }

    @Test
    void acceptsOnlyRasterHeaders()
    {
        assertThat(TelegramChannelThumbnail.contentType(new byte[]
        {(byte) 255, (byte) 216, (byte) 255})).isEqualTo("image/jpeg");
        assertThatThrownBy(() -> TelegramChannelThumbnail.contentType("<html>error</html>".getBytes()))
                .isInstanceOf(com.mayday.common.exception.BusinessException.class);
    }

    @Test
    void metadataCollapsesPhotoSizesAndNeverExposesNativeIdentifiers()
    {
        String metadata = """
                [{"kind":"PHOTO","tdFileId":1234,"width":80,"height":60,"expectedSize":100,"hasThumbnail":true},
                 {"kind":"PHOTO","tdFileId":5678,"width":4000,"height":3000,"expectedSize":9000000}]
                """;
        var media = TelegramChannelMediaPreview.from(snapshot(true, metadata));
        assertThat(media.width()).isEqualTo(4000);
        assertThat(media.hasThumbnail()).isTrue();
        String json = new ObjectMapper().writeValueAsString(media);
        assertThat(json).doesNotContain("tdFileId", "1234", "5678");
        assertThat(TelegramChannelMediaPreview.from(snapshot(false, metadata))).isNull();
        assertThat(TelegramChannelMediaPreview.from(snapshot(true, "invalid"))).isNull();
    }

    private TdApi.PhotoSize size(int id, int width, long bytes)
    {
        return new TdApi.PhotoSize("m", new TdApi.File(id, bytes, bytes, null, null), width, width, new int[0]);
    }

    private TelegramMessageSnapshot snapshot(boolean canSave, String metadata)
    {
        return new TelegramMessageSnapshot("-1001", "10", null, false, "history", "MessagePhoto", null, "[]", "[]",
                null, 1L, null, canSave, null, null, metadata, null, null, null);
    }
}
