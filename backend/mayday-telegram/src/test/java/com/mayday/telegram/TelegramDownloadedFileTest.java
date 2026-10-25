package com.mayday.telegram;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies native thumbnails cannot expand access to TDLib's private database.
 */
class TelegramDownloadedFileTest
{
    @TempDir
    Path root;

    @Test
    void acceptsThumbnailCacheOnlyForThumbnailRequests() throws Exception
    {
        Path thumbnail = file("database/thumbnails/poster.jpg");
        assertThat(TelegramDownloadedFile.checked(root, thumbnail.toString(), 100, true).size()).isEqualTo(3);
        assertThatThrownBy(() -> TelegramDownloadedFile.checked(root, thumbnail.toString(), 100, false))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("受控目录");
    }

    @Test
    void acceptsOrdinaryFilesForBothRequestTypes() throws Exception
    {
        Path photo = file("files/photos/photo.jpg");
        assertThat(TelegramDownloadedFile.checked(root, photo.toString(), 100, false).path())
                .isEqualTo(photo.toRealPath());
        assertThat(TelegramDownloadedFile.checked(root, photo.toString(), 100, true).size()).isEqualTo(3);
    }

    @Test
    void rejectsDatabaseAndSiblingDirectoriesEvenForThumbnails() throws Exception
    {
        file("database/thumbnails/poster.jpg");
        for (String relative : new String[]
        {"database/td.bin", "database/thumbnails-extra/private.bin", "outside.bin"})
        {
            Path privateFile = file(relative);
            assertThatThrownBy(() -> TelegramDownloadedFile.checked(root, privateFile.toString(), 100, true))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("受控目录");
        }
        Path traversal = root.resolve("database/thumbnails/../td.bin");
        assertThatThrownBy(() -> TelegramDownloadedFile.checked(root, traversal.toString(), 100, true))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("受控目录");
    }

    @Test
    void rejectsOversizedOrEmptyThumbnails() throws Exception
    {
        Path thumbnail = file("database/thumbnails/poster.jpg");
        assertThatThrownBy(() -> TelegramDownloadedFile.checked(root, thumbnail.toString(), 2, true))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("大小限制");
        Files.write(thumbnail, new byte[0]);
        assertThatThrownBy(() -> TelegramDownloadedFile.checked(root, thumbnail.toString(), 100, true))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("大小限制");
    }

    private Path file(String relative) throws Exception
    {
        Path path = root.resolve(relative);
        Files.createDirectories(path.getParent());
        return Files.write(path, new byte[]
        {1, 2, 3});
    }
}
