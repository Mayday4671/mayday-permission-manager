package com.mayday.telegram;

import com.mayday.telegram.mapper.TelegramMediaMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Converts the internal TDLib attachment projection into bounded, owner-scoped
 * download work. This service is called only from the message-page transaction.
 */
@Service
@RequiredArgsConstructor
public class TelegramMediaQueueService
{
    private final TelegramMediaMapper media;
    private final ObjectMapper json;
    private final TelegramSettings settings;

    /** Adds only attachment types explicitly selected on the parent task. */
    public void enqueue(TelegramCollectionTask task, TelegramCollectedMessage message)
    {
        if (!Boolean.TRUE.equals(message.getCanBeSaved()) || !hasDownloadPolicy(task))
        {
            return;
        }
        try
        {
            JsonNode attachments = json.readTree(message.getMetadataJson());
            if (attachments == null || !attachments.isArray())
            {
                return;
            }
            for (int index = 0; index < attachments.size(); index++)
            {
                JsonNode item = attachments.get(index);
                String kind = text(item, "kind");
                if (!isSelected(task, kind))
                {
                    continue;
                }
                int fileId = item.path("tdFileId").asInt(-1);
                long expectedSize = Math.max(0, item.path("expectedSize").asLong(0));
                if (fileId <= 0)
                {
                    continue;
                }
                TelegramMedia row = new TelegramMedia();
                row.setOwnerId(task.getOwnerId());
                row.setDepartmentId(task.getDepartmentId());
                row.setTaskId(task.getId());
                row.setMessageId(message.getId());
                row.setAttachmentIndex(index);
                row.setTelegramFileId(fileId);
                row.setKind(kind);
                row.setFileName(text(item, "fileName"));
                row.setExpectedSize(expectedSize);
                row.setAttemptCount(0);
                // Preview records describe remote attachments; no format may implicitly
                // enqueue a full download. Conversion or collection must be explicit.
                if (Boolean.TRUE.equals(task.getPreviewOnly()))
                {
                    row.setStatus("REMOTE");
                } else if (settings.getConfiguredMaxMediaFileBytes() > 0
                        && expectedSize > settings.getConfiguredMaxMediaFileBytes())
                {
                    row.setStatus("FAILED");
                    row.setFailureMessage("附件超过服务端配置的单文件大小上限");
                } else
                {
                    row.setStatus("QUEUED");
                }
                media.save(row);
            }
        } catch (JacksonException exception)
        {
            // JSON is produced by the server adapter; corruption should roll back the page
            // rather than hide missing files.
            throw new IllegalStateException("Telegram 附件元数据格式无效", exception);
        }
    }

    private boolean hasDownloadPolicy(TelegramCollectionTask task)
    {
        return Boolean.TRUE.equals(task.getDownloadImages()) || Boolean.TRUE.equals(task.getDownloadVideos())
                || Boolean.TRUE.equals(task.getDownloadDocuments());
    }

    private boolean isSelected(TelegramCollectionTask task, String kind)
    {
        return switch (kind)
        {
            case "PHOTO" -> Boolean.TRUE.equals(task.getDownloadImages());
            case "VIDEO", "ANIMATION" -> Boolean.TRUE.equals(task.getDownloadVideos());
            case "DOCUMENT", "AUDIO", "VOICE" -> Boolean.TRUE.equals(task.getDownloadDocuments());
            default -> false;
        };
    }

    private String text(JsonNode item, String field)
    {
        JsonNode value = item.get(field);
        return value == null || value.isNull() ? null : value.asString();
    }
}
