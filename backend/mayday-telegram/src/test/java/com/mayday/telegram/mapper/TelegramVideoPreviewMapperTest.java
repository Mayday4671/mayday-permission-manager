package com.mayday.telegram.mapper;

import java.lang.reflect.Modifier;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

import com.mayday.telegram.TelegramCollectionTask;
import com.mayday.telegram.TelegramMedia;
import com.mayday.telegram.TelegramVideoPreview;
import com.mybatisflex.core.mybatis.FlexConfiguration;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.mapping.ResultMapping;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Native queue SQL must populate ownership and leases independently of global
 * naming conventions.
 */
class TelegramVideoPreviewMapperTest
{
    @Test
    void mapsQueuedAndExpiredPreviewRowsWhenUnderscoreMappingIsDisabled()
    {
        FlexConfiguration configuration = mappingConfiguration(TelegramVideoPreviewMapper.class);
        for (String method : new String[]
        {"lockNext", "lockExpired"})
        {
            Map<String, String> mappings = configuration
                    .getMappedStatement(TelegramVideoPreviewMapper.class.getName() + "." + method).getResultMaps()
                    .getFirst().getResultMappings().stream()
                    .collect(Collectors.toMap(ResultMapping::getColumn, ResultMapping::getProperty));
            assertThat(mappings).containsEntry("owner_id", "ownerId").containsEntry("department_id", "departmentId")
                    .containsEntry("media_id", "mediaId").containsEntry("lease_owner", "leaseOwner")
                    .containsEntry("lease_expires_at", "leaseExpiresAt").containsEntry("attempt_count", "attemptCount")
                    .containsEntry("reserved_bytes", "reservedBytes").containsEntry("created_at", "createdAt")
                    .containsEntry("updated_at", "updatedAt");
            assertAllUnderscoreFieldsMapped(mappings, TelegramVideoPreview.class);
        }
    }

    @Test
    void mapsRetentionStorageKeysAndMediaLeaseFields()
    {
        Map<String, String> mappings = mappings(TelegramMediaMapper.class, "lockExpired");
        assertThat(mappings).containsEntry("storage_key", "storageKey")
                .containsEntry("storage_provider", "storageProvider").containsEntry("task_id", "taskId");
        assertAllUnderscoreFieldsMapped(mappings, TelegramMedia.class);
    }

    @Test
    void mapsTrackingOwnerCursorAndCollectionPolicyFields()
    {
        Map<String, String> mappings = mappings(TelegramCollectionTaskMapper.class, "lockNextTracking");
        assertThat(mappings).containsEntry("owner_id", "ownerId").containsEntry("chat_id", "chatId")
                .containsEntry("live_cursor_message_id", "liveCursorMessageId")
                .containsEntry("download_documents", "downloadDocuments");
        assertAllUnderscoreFieldsMapped(mappings, TelegramCollectionTask.class);
    }

    private Map<String, String> mappings(Class<?> mapper, String method)
    {
        return mappingConfiguration(mapper).getMappedStatement(mapper.getName() + "." + method).getResultMaps()
                .getFirst().getResultMappings().stream()
                .collect(Collectors.toMap(ResultMapping::getColumn, ResultMapping::getProperty));
    }

    /**
     * The mapper registry requires an environment, but this metadata test never
     * opens a connection.
     */
    private FlexConfiguration mappingConfiguration(Class<?> mapper)
    {
        FlexConfiguration configuration = new FlexConfiguration();
        configuration.setEnvironment(new Environment("mapping-test-" + mapper.getSimpleName(),
                new JdbcTransactionFactory(), new UnpooledDataSource()));
        configuration.setMapUnderscoreToCamelCase(false);
        configuration.addMapper(mapper);
        return configuration;
    }

    /**
     * New entity fields must not silently disappear when read through a native
     * queue query.
     */
    private void assertAllUnderscoreFieldsMapped(Map<String, String> mappings, Class<?> entity)
    {
        for (Class<?> type = entity; type != Object.class; type = type.getSuperclass())
        {
            for (var field : type.getDeclaredFields())
            {
                if (Modifier.isStatic(field.getModifiers()) || field.isSynthetic())
                {
                    continue;
                }
                String column = field.getName().replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT);
                if (column.contains("_"))
                {
                    assertThat(mappings).as(entity.getSimpleName() + "." + field.getName()).containsEntry(column,
                            field.getName());
                }
            }
        }
    }
}
