package com.mayday.telegram;

import java.util.Locale;
import java.util.Set;

/**
 * Decides whether a downloaded attachment may enter video inspection. MIME
 * types and filename extensions are only eligibility hints; FFprobe still
 * validates the stored bytes, container, video stream and resource limits
 * before preview.
 */
final class TelegramVideoMediaPolicy
{
    private static final Set<String> VIDEO_KINDS = Set.of("VIDEO", "ANIMATION", "DOCUMENT");
    private static final Set<String> VIDEO_TYPES = Set.of("video/mp4", "video/webm", "video/x-matroska",
            "video/quicktime");
    private static final Set<String> VIDEO_EXTENSIONS = Set.of("mp4", "m4v", "webm", "mkv", "mov");

    private TelegramVideoMediaPolicy()
    {
    }

    /**
     * Unknown file types require an explicit supported extension, not a video-like
     * title.
     */
    static boolean isPreviewCandidate(TelegramMedia media)
    {
        if (media == null || media.getKind() == null || !VIDEO_KINDS.contains(media.getKind()))
        {
            return false;
        }
        String type = media.getMediaType() == null ? "" : media.getMediaType().trim().toLowerCase(Locale.ROOT);
        if (VIDEO_TYPES.contains(type))
        {
            return true;
        }
        if (!type.isEmpty() && !"application/octet-stream".equals(type))
        {
            return false;
        }
        String filename = media.getFileName();
        if (filename == null)
        {
            return false;
        }
        int extensionStart = filename.lastIndexOf('.');
        return extensionStart >= 0
                && VIDEO_EXTENSIONS.contains(filename.substring(extensionStart + 1).toLowerCase(Locale.ROOT));
    }

    /**
     * Telegram documents follow the document opt-in even when their payload is a
     * video.
     */
    static boolean isDownloadAllowed(TelegramMedia media, TelegramCollectionTask task)
    {
        if (!isPreviewCandidate(media) || task == null)
        {
            return false;
        }
        return Boolean.TRUE
                .equals("DOCUMENT".equals(media.getKind()) ? task.getDownloadDocuments() : task.getDownloadVideos());
    }
}
