package com.mayday.telegram;

import com.mayday.common.web.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Joined-channel directory, history and permalink endpoints for the current
 * Telegram account.
 */
@RestController
@RequestMapping("/api/telegram/channels")
@RequiredArgsConstructor
@PreAuthorize("@access.has('telegram:collect') and @access.has('telegram:view')")
public class TelegramChannelController
{
    private final TelegramChannelBrowserService browser;

    /** Reads one directory batch without requiring a search term. */
    @GetMapping
    public ApiResponse<TelegramChannelBrowserService.ChannelPage> channels(
            @RequestParam(defaultValue = "0:0") String cursor)
    {
        return ApiResponse.ok(browser.channels(cursor));
    }

    /** Reads one history page without persisting or downloading message content. */
    @GetMapping("/{chatId}/messages")
    public ApiResponse<TelegramChannelBrowserService.MessagePage> messages(@PathVariable String chatId,
            @RequestParam(defaultValue = "0") String before)
    {
        return ApiResponse.ok(browser.messages(chatId, before));
    }

    /**
     * Searches indexed history with optional media and inclusive date filters.
     */
    @GetMapping("/{chatId}/search")
    public ApiResponse<TelegramChannelBrowserService.MessagePage> search(@PathVariable String chatId,
            @RequestParam(defaultValue = "") String query, @RequestParam(defaultValue = "ALL") String type,
            @RequestParam(defaultValue = "0") String cursor, @RequestParam(required = false) Long from,
            @RequestParam(required = false) Long to)
    {
        return ApiResponse.ok(browser.search(chatId, query, type, cursor, from, to));
    }

    /**
     * Retrieves the canonical Telegram URL only when the user selects a message.
     */
    @GetMapping("/{chatId}/messages/{messageId}/link")
    public ApiResponse<String> link(@PathVariable String chatId, @PathVariable String messageId)
    {
        return ApiResponse.ok(browser.link(chatId, messageId));
    }
}
