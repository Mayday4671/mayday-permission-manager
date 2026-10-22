package com.mayday.telegram;

import java.util.Base64;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Safely resolves callback button data from a previously captured Telegram
 * message. The browser only provides row and column indexes; it cannot submit
 * arbitrary callback bytes or select a different chat/message.
 */
final class TelegramInlineKeyboard
{
    private static final int MAX_CALLBACK_BYTES = 64;
    private static final JsonMapper JSON_MAPPER = JsonMapper.builder().build();

    private TelegramInlineKeyboard()
    {
    }

    /**
     * Returns the bounded callback payload at the requested zero-based position.
     * URL buttons and unsupported button types are rejected as non-callbacks.
     *
     * @param replyMarkupJson
     *            captured allow-listed inline keyboard JSON
     * @param rowIndex
     *            zero-based keyboard row
     * @param columnIndex
     *            zero-based button column
     * @return the decoded callback payload copied from the stored Telegram update
     */
    static byte[] requireCallbackData(String replyMarkupJson, int rowIndex, int columnIndex)
    {
        if (rowIndex < 0 || columnIndex < 0 || rowIndex > 19 || columnIndex > 19)
        {
            throw new IllegalArgumentException("按钮位置无效");
        }
        try
        {
            JsonNode rows = JSON_MAPPER.readTree(replyMarkupJson);
            JsonNode button = rows.path(rowIndex).path(columnIndex);
            if (!button.isObject() || !"CALLBACK".equals(button.path("type").asString()))
            {
                throw new IllegalArgumentException("所选按钮不是可执行的回调按钮");
            }
            String encoded = button.path("data").asString("");
            byte[] data = Base64.getDecoder().decode(encoded);
            if (data.length == 0 || data.length > MAX_CALLBACK_BYTES)
            {
                throw new IllegalArgumentException("按钮回调数据长度无效");
            }
            return data;
        } catch (JacksonException exception)
        {
            throw new IllegalArgumentException("消息按钮数据格式无效", exception);
        }
    }
}
