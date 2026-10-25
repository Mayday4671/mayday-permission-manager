package com.mayday.telegram;

import com.mayday.common.web.ApiResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

    /**
     * Returns authenticated raster bytes, never native file identifiers or disk
     * paths.
     */
    @GetMapping(value = "/{chatId}/messages/{messageId}/thumbnail", produces =
    {"image/jpeg", "image/png", "image/webp"})
    @PreAuthorize("@access.has('telegram:collect') and @access.has('telegram:view') and @access.has('telegram:download')")
    public ResponseEntity<byte[]> thumbnail(@PathVariable String chatId, @PathVariable String messageId)
    {
        byte[] bytes = browser.thumbnail(chatId, messageId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType(TelegramChannelThumbnail.contentType(bytes)))
                .header("X-Content-Type-Options", "nosniff").body(bytes);
    }

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
