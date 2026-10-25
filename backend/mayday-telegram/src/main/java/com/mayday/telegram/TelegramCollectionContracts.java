package com.mayday.telegram;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import org.jspecify.annotations.Nullable;

/**
 * Stable API projections for collection progress and saved Telegram messages.
 */
public final class TelegramCollectionContracts
{
    private TelegramCollectionContracts()
    {
    }

    /** Task status and progress without lease internals or file identifiers. */
    public record TaskView(Long id, @Nullable String messageLink, @Nullable String sourceTitle,
            @Nullable LocalDate fromDate, @Nullable LocalDate toDate, String status, String statusMessage,
            Integer maxMessages, Integer collectedMessages, Integer scannedMessages, boolean includeAlbum,
            boolean trackingEnabled, @Nullable LocalDateTime liveCheckedAt, @Nullable String liveStatusMessage,
            LocalDateTime createdAt, LocalDateTime updatedAt, long pendingMediaCount) {
        /** Converts the persistent task into a safe response. */
        public static TaskView from(TelegramCollectionTask task)
        {
            return from(task, 0);
        }

        /** 附件队列与消息采集分别结束，单独返回待下载数量供页面提供停止入口。 */
        public static TaskView from(TelegramCollectionTask task, long pendingMediaCount)
        {
            return new TaskView(task.getId(), task.getMessageLink(), task.getSourceTitle(), task.getFromDate(),
                    task.getToDate(), task.getStatus(), task.getStatusMessage(), task.getMaxMessages(),
                    task.getCollectedMessages(), task.getScannedMessages(), Boolean.TRUE.equals(task.getIncludeAlbum()),
                    Boolean.TRUE.equals(task.getTrackingEnabled()), task.getLiveCheckedAt(),
                    task.getLiveStatusMessage(), task.getCreatedAt(), task.getUpdatedAt(), pendingMediaCount);
        }
    }

    /**
     * User-safe message metadata; TDLib file IDs and local paths are never
     * returned.
     */
    public record CollectedMessageView(Long id, String telegramMessageId, String senderId, String contentType,
            String messageText, boolean canBeSaved, String albumId, String topicId, String metadataJson,
            LocalDateTime telegramSentAt, LocalDateTime telegramEditedAt, List<MediaView> media) {
        /** Maps only fields intended for authorized message review. */
        public static CollectedMessageView from(TelegramCollectedMessage message, List<TelegramMedia> media,
                boolean canDownload)
        {
            return new CollectedMessageView(message.getId(), message.getTelegramMessageId(), message.getSenderId(),
                    message.getContentType(), message.getMessageText(), Boolean.TRUE.equals(message.getCanBeSaved()),
                    message.getAlbumId(), message.getTopicId(), publicMetadata(message.getMetadataJson()),
                    message.getTelegramSentAt(), message.getTelegramEditedAt(),
                    media.stream()
                            .map(item -> new MediaView(item.getId(), item.getKind(), item.getFileName(),
                                    item.getExpectedSize(), item.getActualSize(), item.getMediaType(), item.getStatus(),
                                    canDownload && List.of("AVAILABLE", "REMOTE").contains(item.getStatus())
                                            ? "/api/telegram/media/" + item.getId() + "/content"
                                            : null,
                                    item.getFailureMessage()))
                            .toList());
        }

        /**
         * Removes session-bound file handles while retaining safe descriptive metadata.
         */
        private static String publicMetadata(String metadataJson)
        {
            try
            {
                var mapper = new tools.jackson.databind.ObjectMapper();
                var metadata = mapper.readTree(metadataJson);
                if (metadata == null || !metadata.isArray())
                {
                    return "[]";
                }
                List<java.util.Map<String, Object>> safe = new java.util.ArrayList<>();
                for (var item : metadata)
                {
                    java.util.Map<String, Object> view = new java.util.LinkedHashMap<>();
                    for (String field : List.of("kind", "size", "expectedSize", "fileName", "width", "height",
                            "durationSeconds", "supportsStreaming"))
                    {
                        var value = item.get(field);
                        if (value != null)
                        {
                            view.put(field,
                                    value.isNumber()
                                            ? value.numberValue()
                                            : value.isBoolean() ? value.booleanValue() : value.stringValue());
                        }
                    }
                    safe.add(view);
                }
                return mapper.writeValueAsString(safe);
            } catch (tools.jackson.core.JacksonException exception)
            {
                return "[]";
            }
        }
    }

    /**
     * Safe attachment state; internal TDLib IDs, storage keys and local paths are
     * omitted.
     */
    public record MediaView(Long id, String kind, String fileName, Long expectedSize, Long actualSize, String mediaType,
            String status, String contentUrl, String failureMessage) {
    }

    /** A short-lived media capability, never a Mayday login token. */
    public record MediaStreamTicketView(String url, LocalDateTime expiresAt) {
    }
}
