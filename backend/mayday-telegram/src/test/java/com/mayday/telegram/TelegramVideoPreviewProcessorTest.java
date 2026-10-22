package com.mayday.telegram;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import com.mayday.common.exception.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Verifies strict media metadata and local-only HLS manifest handling. */
class TelegramVideoPreviewProcessorTest
{
    @TempDir
    Path temporaryDirectory;

    private TelegramVideoPreviewProcessor processor;

    @BeforeEach
    void setUp()
    {
        TelegramSettings settings = new TelegramSettings();
        processor = new TelegramVideoPreviewProcessor(settings, new ObjectMapper());
    }

    @Test
    void acceptsOnlyKnownVideoContainersAndBoundedDurations()
    {
        var result = processor.parseProbe("""
                {"format":{"format_name":"matroska,webm","duration":"12.5"},
                 "streams":[{"codec_type":"video","codec_name":"vp9","width":1920,
                 "height":1080,"pix_fmt":"yuv420p"},{"codec_type":"audio","codec_name":"opus"}]}
                """);

        assertThat(result.durationSeconds()).isEqualTo(new java.math.BigDecimal("12.5"));
        assertThat(result.videoCodec()).isEqualTo("vp9");
        assertThat(result.audioCodec()).isEqualTo("opus");
        assertThat(result.width()).isEqualTo(1920);
    }

    @Test
    void rejectsUnsupportedContainerAndExcessiveDuration()
    {
        assertThatThrownBy(() -> processor.parseProbe("""
                {"format":{"format_name":"avi","duration":"5"},
                 "streams":[{"codec_type":"video","codec_name":"h264","width":640,
                 "height":360,"pix_fmt":"yuv420p"}]}
                """)).isInstanceOf(BusinessException.class);

        assertThatThrownBy(() -> processor.parseProbe("""
                {"format":{"format_name":"mov,mp4","duration":"9000"},
                 "streams":[{"codec_type":"video","codec_name":"h264","width":640,
                 "height":360,"pix_fmt":"yuv420p"}]}
                """)).isInstanceOf(BusinessException.class);
    }

    @Test
    void validatesACompleteManifestAndTracksExactLocalAssets() throws Exception
    {
        Path segment = Files.write(temporaryDirectory.resolve("segment_00000.ts"), new byte[]
        {0, 1, 2, 3});
        Path manifest = Files.writeString(temporaryDirectory.resolve("index.m3u8"), """
                #EXTM3U
                #EXT-X-VERSION:3
                #EXT-X-TARGETDURATION:6
                #EXTINF:2.000000,
                segment_00000.ts
                #EXT-X-ENDLIST
                """);

        List<TelegramVideoPreviewProcessor.PreviewAsset> assets = TelegramVideoPreviewProcessor
                .validateManifest(manifest, temporaryDirectory, 1024);

        assertThat(assets).extracting(TelegramVideoPreviewProcessor.PreviewAsset::name).containsExactly("index.m3u8",
                "segment_00000.ts");
        assertThat(assets.get(1).path()).isEqualTo(segment);
    }

    @Test
    void rejectsRemotePathsKeysAndMissingSegments() throws Exception
    {
        Path segment = Files.write(temporaryDirectory.resolve("segment_00000.ts"), new byte[]
        {1});
        assertThat(segment).exists();
        Path manifest = Files.writeString(temporaryDirectory.resolve("index.m3u8"), """
                #EXTM3U
                #EXT-X-KEY:METHOD=AES-128,URI="https://example.invalid/key"
                #EXTINF:2.0,
                https://example.invalid/segment.ts
                #EXT-X-ENDLIST
                """);

        assertThatThrownBy(() -> TelegramVideoPreviewProcessor.validateManifest(manifest, temporaryDirectory, 1024))
                .isInstanceOf(BusinessException.class);

        Files.writeString(manifest, """
                #EXTM3U
                #EXTINF:2.0,
                https://example.invalid/segment.ts
                #EXT-X-ENDLIST
                """);
        assertThatThrownBy(() -> TelegramVideoPreviewProcessor.validateManifest(manifest, temporaryDirectory, 1024))
                .isInstanceOf(BusinessException.class);

        Files.writeString(manifest, """
                #EXTM3U
                #EXTINF:2.0,
                segment_99999.ts
                #EXT-X-ENDLIST
                """);
        assertThatThrownBy(() -> TelegramVideoPreviewProcessor.validateManifest(manifest, temporaryDirectory, 1024))
                .isInstanceOf(BusinessException.class);
    }
}
