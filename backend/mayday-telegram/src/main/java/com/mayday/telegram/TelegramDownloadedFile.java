package com.mayday.telegram;

import java.nio.file.Path;

/**
 * Internal result from the TDLib adapter; the path never enters an API
 * response.
 */
public record TelegramDownloadedFile(Path path, long size) {
}
