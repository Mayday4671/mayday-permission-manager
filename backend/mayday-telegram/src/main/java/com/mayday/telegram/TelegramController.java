package com.mayday.telegram;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.mayday.common.persistence.PageResult;
import com.mayday.common.web.ApiResponse;
import com.mayday.telegram.TelegramCollectionContracts.CollectedMessageView;
import com.mayday.telegram.TelegramCollectionContracts.TaskView;
import com.mayday.telegram.TelegramSearchContracts.CallbackAnswerView;
import com.mayday.telegram.TelegramSearchContracts.ConversationTurnView;
import com.mayday.telegram.TelegramSearchContracts.MessageView;
import com.mayday.telegram.TelegramSearchContracts.ParsedMessageView;
import com.mayday.telegram.TelegramSearchContracts.SearchView;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Telegram account lifecycle API; each state transition requires a server-side
 * permission check.
 */
@RestController
@RequestMapping("/api/telegram")
@RequiredArgsConstructor
public class TelegramController
{
    private final TelegramSessionCoordinator sessions;
    private final TelegramSearchService searches;
    private final TelegramCollectionService collections;
    private final TelegramMediaDownloadService mediaDownloads;
    private final TelegramArchiveService archives;
    private final TelegramVideoPreviewService videoPreviews;
    private final TelegramConfigurationService configuration;
    private final TelegramMediaPolicyService mediaPolicy;

    /**
     * Returns an authorized source cover without transferring the original video.
     */
    @GetMapping(value = "/media/{id}/thumbnail", produces =
    {"image/jpeg", "image/png", "image/webp"})
    @PreAuthorize("@access.has('telegram:view') and @access.has('telegram:download')")
    public ResponseEntity<byte[]> mediaThumbnail(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        byte[] bytes = mediaDownloads.thumbnail(id);
        return ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore())
                .contentType(
                        org.springframework.http.MediaType.parseMediaType(TelegramChannelThumbnail.contentType(bytes)))
                .header("X-Content-Type-Options", "nosniff").body(bytes);
    }

    /** Reads independently editable attachment download policy. */
    @GetMapping("/media-policy")
    @PreAuthorize("@access.has('telegram:configure')")
    public ApiResponse<TelegramMediaPolicyService.Policy> mediaPolicy()
    {
        return ApiResponse.ok(mediaPolicy.read());
    }

    /**
     * Saves media policy while keeping an authorized Telegram session connected.
     */
    @PutMapping("/media-policy")
    @PreAuthorize("@access.has('telegram:configure')")
    public ApiResponse<TelegramMediaPolicyService.Policy> saveMediaPolicy(
            @RequestBody TelegramMediaPolicyService.Policy policy)
    {
        return ApiResponse.ok(mediaPolicy.save(policy));
    }

    /** Creates a capability for a browser-managed attachment download. */
    @PostMapping("/media/{id}/download-ticket")
    @PreAuthorize("@access.has('telegram:download')")
    public ApiResponse<TelegramCollectionContracts.MediaStreamTicketView> downloadTicket(
            @org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(mediaDownloads.createDownloadTicket(id));
    }

    /**
     * Serves original attachment bytes after validating the download capability and
     * current access.
     */
    @GetMapping("/media/{id}/download")
    public ResponseEntity<Resource> downloadAttachment(@org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam String ticket,
            @org.springframework.web.bind.annotation.RequestHeader(value = "Range", required = false) String range)
    {
        return mediaDownloads.downloadContent(id, ticket, range);
    }

    /**
     * Returns editable Telegram connection settings without returning any secret
     * value.
     */
    @org.springframework.web.bind.annotation.GetMapping("/configuration")
    @PreAuthorize("@access.has('telegram:configure')")
    public ApiResponse<TelegramConfigurationService.SettingsView> configuration()
    {
        return ApiResponse.ok(configuration.getSettings());
    }

    /**
     * Persists an authorized settings update and applies it immediately for the
     * next Telegram connection.
     */
    @PutMapping("/configuration")
    @PreAuthorize("@access.has('telegram:configure')")
    public ApiResponse<TelegramConfigurationService.SettingsView> saveConfiguration(
            @Valid @RequestBody ConfigurationRequest request)
    {
        return ApiResponse.ok(configuration.save(new TelegramConfigurationService.SettingsRequest(request.apiId(),
                request.apiHash(), request.proxyEnabled(), request.proxyType(), request.proxyHost(),
                request.proxyPort(), request.proxyUsername(), request.proxyPassword(), request.proxySecret())));
    }

    /**
     * Input limits mirror the service validation; secret fields are write-only and
     * blank values retain existing data.
     */
    public record ConfigurationRequest(@NotBlank @Pattern(regexp = "[1-9][0-9]{0,9}") String apiId,
            @Size(max = 512) String apiHash, boolean proxyEnabled,
            @NotBlank @Pattern(regexp = "(?i)socks5|http|mtproto") String proxyType, @Size(max = 253) String proxyHost,
            @Min(0) @Max(65535) int proxyPort, @Size(max = 255) String proxyUsername,
            @Size(max = 255) String proxyPassword, @Size(max = 512) String proxySecret) {

        /**
         * Prevents diagnostic rendering from including write-only API or proxy
         * credentials.
         */
        @Override
        public String toString()
        {
            return "ConfigurationRequest[apiId=" + apiId + ", apiHash=<redacted>, proxyEnabled=" + proxyEnabled
                    + ", proxyType=" + proxyType + ", proxyHost=" + proxyHost + ", proxyPort=" + proxyPort
                    + ", proxyUsername=" + proxyUsername + ", proxyPassword=<redacted>, proxySecret=<redacted>]";
        }
    }

    /**
     * Queues browser-compatible HLS generation for one downloaded video attachment.
     */
    @PostMapping("/media/{id}/video-preview")
    @PreAuthorize("@access.has('telegram:download')")
    public ApiResponse<TelegramVideoPreviewContracts.PreviewView> requestVideoPreview(
            @org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(videoPreviews.request(id));
    }

    /** Reads the persisted status for the caller-authorized video preview job. */
    @GetMapping("/media/{id}/video-preview")
    @PreAuthorize("@access.has('telegram:download')")
    public ApiResponse<TelegramVideoPreviewContracts.PreviewView> videoPreviewStatus(
            @org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(videoPreviews.status(id));
    }

    /**
     * Cancels a queued or running video preview and terminates its local encoder.
     */
    @PostMapping("/media/{id}/video-preview/cancel")
    @PreAuthorize("@access.has('telegram:download')")
    public ApiResponse<TelegramVideoPreviewContracts.PreviewView> cancelVideoPreview(
            @org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(videoPreviews.cancel(id));
    }

    /**
     * Streams a manifest or generated segment after rechecking source and
     * data-scope access.
     */
    @GetMapping("/media/{id}/hls/{assetName}")
    @PreAuthorize("@access.has('telegram:download')")
    public ResponseEntity<Resource> videoPreviewAsset(@org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.PathVariable String assetName)
    {
        return videoPreviews.asset(id, assetName);
    }

    /**
     * Lists a bounded page from an available ZIP owned by the authorized user
     * scope.
     */
    @GetMapping("/media/{id}/archive-entries")
    @PreAuthorize("@access.has('telegram:extract')")
    public ApiResponse<TelegramArchiveService.ArchivePage> archiveEntries(
            @org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "50") int size)
    {
        return ApiResponse.ok(archives.entries(id, page, size));
    }

    /**
     * Extracts one selected ZIP entry into a bounded private temporary file and
     * streams it.
     */
    @GetMapping("/media/{id}/archive-entry")
    @PreAuthorize("@access.has('telegram:extract')")
    public ResponseEntity<Resource> archiveEntry(@org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam String name,
            @org.springframework.web.bind.annotation.RequestHeader(value = "Range", required = false) String range)
    {
        return archives.entry(id, name, range);
    }

    /**
     * Streams one authorized file; bytes and native TDLib handles are never copied
     * into API metadata.
     */
    @GetMapping("/media/{id}/content")
    @PreAuthorize("@access.has('telegram:download')")
    public ResponseEntity<Resource> mediaContent(@org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestHeader(value = "Range", required = false) String range)
    {
        return mediaDownloads.content(id, range);
    }

    /**
     * Issues an expiring media-only capability for native HTML video playback and
     * seeking.
     */
    @PostMapping("/media/{id}/stream-ticket")
    @PreAuthorize("@access.has('telegram:download')")
    public ApiResponse<com.mayday.telegram.TelegramCollectionContracts.MediaStreamTicketView> mediaStreamTicket(
            @org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(mediaDownloads.createStreamTicket(id));
    }

    /**
     * Streams native browser Range requests using the expiring capability; every
     * request rechecks owner permissions.
     */
    @GetMapping("/media/{id}/stream")
    @PreAuthorize("permitAll()")
    public ResponseEntity<Resource> streamMedia(@org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam String ticket,
            @org.springframework.web.bind.annotation.RequestHeader(value = "Range", required = false) String range)
    {
        return mediaDownloads.stream(id, ticket, range);
    }

    /** Retries one failed attachment under the task's persisted selection rules. */
    @PostMapping("/media/{id}/retry")
    @PreAuthorize("@access.has('telegram:download')")
    public ApiResponse<com.mayday.telegram.TelegramCollectionContracts.MediaView> retryMedia(
            @org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(mediaDownloads.retry(id));
    }

    /**
     * Creates a bounded, user-owned task from an accessible message link or a
     * channel already joined by the connected account.
     */
    @PostMapping("/collections")
    @PreAuthorize("@access.has('telegram:collect')")
    public ApiResponse<TaskView> createCollection(@Valid @RequestBody TelegramCollectionRequest request)
    {
        return ApiResponse.ok(collections.create(request));
    }

    /** Searches only chats already visible to the connected Telegram account. */
    @GetMapping("/collections/channels")
    @PreAuthorize("@access.has('telegram:collect')")
    public ApiResponse<java.util.List<TelegramChannelOption>> collectionChannels(
            @org.springframework.web.bind.annotation.RequestParam String query,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "20") int size)
    {
        return ApiResponse.ok(collections.searchChannels(query, size));
    }

    /** Lists persisted tasks in the current user's authorized data scope. */
    @GetMapping("/collections")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<TaskView>> collections(
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "20") int size)
    {
        return ApiResponse.ok(collections.list(page, size));
    }

    /** Reports task failures and progress separately from an empty message page. */
    @GetMapping("/collections/{id}")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<TaskView> collection(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(collections.detail(id));
    }

    /** Returns saved text and safe attachment metadata for one visible task. */
    @GetMapping("/collections/{id}/messages")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<CollectedMessageView>> collectionMessages(
            @org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "50") int size)
    {
        return ApiResponse.ok(collections.listMessages(id, page, size));
    }

    /** Pauses future task pages while preserving the last committed cursor. */
    @PostMapping("/collections/{id}/pause")
    @PreAuthorize("@access.has('telegram:collect')")
    public ApiResponse<TaskView> pauseCollection(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(collections.pause(id));
    }

    /** Resumes a paused task from its committed history cursor. */
    @PostMapping("/collections/{id}/resume")
    @PreAuthorize("@access.has('telegram:collect')")
    public ApiResponse<TaskView> resumeCollection(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(collections.resume(id));
    }

    /**
     * Cancels pending history reads without deleting already saved message records.
     */
    @PostMapping("/collections/{id}/cancel")
    @PreAuthorize("@access.has('telegram:collect')")
    public ApiResponse<TaskView> cancelCollection(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(collections.cancel(id));
    }

    /** Toggles the separate, explicitly requested periodic catch-up mode. */
    @PostMapping("/collections/{id}/tracking")
    @PreAuthorize("@access.has('telegram:collect')")
    public ApiResponse<TaskView> trackCollection(@org.springframework.web.bind.annotation.PathVariable Long id,
            @Valid @RequestBody TelegramTrackingRequest request)
    {
        return ApiResponse.ok(collections.setTracking(id, request.enabled()));
    }

    /**
     * Deletes a stopped task and its captured messages under the cleanup
     * permission.
     */
    @org.springframework.web.bind.annotation.DeleteMapping("/collections/{id}")
    @PreAuthorize("@access.has('telegram:delete')")
    public ApiResponse<Void> deleteCollection(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        collections.delete(id);
        return ApiResponse.ok(null);
    }

    /**
     * Lists owner-scoped conversation sessions for the Telegram sidebar.
     */
    @GetMapping("/conversations")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<TelegramConversationView>> conversations(
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "50") int size)
    {
        return ApiResponse.ok(searches.listConversations(page, size));
    }

    /** Creates an empty, owner-scoped search conversation. */
    @PostMapping("/conversations")
    @PreAuthorize("@access.has('telegram:search')")
    public ApiResponse<TelegramConversationView> createConversation()
    {
        return ApiResponse.ok(searches.createConversation());
    }

    /**
     * Deletes one idle conversation and its associated local search/message
     * history.
     */
    @org.springframework.web.bind.annotation.DeleteMapping("/conversations/{id}")
    @PreAuthorize("@access.has('telegram:delete')")
    public ApiResponse<Void> deleteConversation(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        searches.deleteConversation(id);
        return ApiResponse.ok(null);
    }

    /**
     * Returns one paginated owner-scoped conversation. Each turn includes its
     * request, associated bot messages, and links parsed from those same messages.
     */
    @GetMapping("/conversation")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<ConversationTurnView>> conversation(
            @org.springframework.web.bind.annotation.RequestParam Long conversationId,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "20") int size)
    {
        return ApiResponse.ok(searches.listConversation(conversationId, page, size));
    }

    /**
     * Starts one user-requested search against the bot selected by server
     * configuration.
     */
    @PostMapping("/searches")
    @PreAuthorize("@access.has('telegram:search')")
    public ApiResponse<SearchView> search(@Valid @RequestBody TelegramSearchRequest request)
    {
        return ApiResponse.ok(searches.create(request.keyword(), request.conversationId()));
    }

    /**
     * Lists the current user's authorized search history with SQL-enforced data
     * range filtering.
     */
    @GetMapping("/searches")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<SearchView>> searches(
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "20") int size)
    {
        return ApiResponse.ok(searches.list(page, size));
    }

    /**
     * Reads one authorized search record without accepting owner IDs from the
     * browser.
     */
    @GetMapping("/searches/{id}")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<SearchView> search(@org.springframework.web.bind.annotation.PathVariable Long id)
    {
        return ApiResponse.ok(searches.get(id));
    }

    /**
     * Returns a separately paginated list of raw, explicitly projected bot
     * messages.
     */
    @GetMapping("/searches/{id}/messages")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<MessageView>> messages(@org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "30") int size)
    {
        return ApiResponse.ok(searches.listMessages(id, page, size));
    }

    /**
     * Returns link candidates inferred from replies, with source message context.
     */
    @GetMapping("/searches/{id}/results")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<ParsedMessageView>> results(
            @org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "30") int size)
    {
        return ApiResponse.ok(searches.listParsedMessages(id, page, size));
    }

    /**
     * Activates a callback button from a message in the specified visible search.
     * Only the stored button's row/column can be selected from the browser.
     */
    @PostMapping("/searches/{id}/messages/{messageId}/buttons/{row}/{column}")
    @PreAuthorize("@access.has('telegram:search')")
    public ApiResponse<CallbackAnswerView> activateButton(@org.springframework.web.bind.annotation.PathVariable Long id,
            @org.springframework.web.bind.annotation.PathVariable Long messageId,
            @org.springframework.web.bind.annotation.PathVariable int row,
            @org.springframework.web.bind.annotation.PathVariable int column)
    {
        return ApiResponse.ok(searches.activateCallback(id, messageId, row, column));
    }

    /**
     * Lists explicitly unmatched updates without exposing the account's other
     * chats.
     */
    @GetMapping("/messages/unmatched")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<PageResult<MessageView>> unmatchedMessages(
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "1") int page,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "30") int size)
    {
        return ApiResponse.ok(searches.listUnmatchedMessages(page, size));
    }

    /**
     * Returns safe readiness without exposing API credentials, local paths, codes,
     * or full phone numbers.
     */
    @GetMapping("/status")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> status()
    {
        return ApiResponse.ok(sessions.status());
    }

    /**
     * Reads the active Telegram account and configured search-bot peer state
     * without sending a test message or changing account settings.
     */
    @GetMapping("/session/bot-diagnostic")
    @PreAuthorize("@access.has('telegram:view')")
    public ApiResponse<TelegramBotSessionDiagnostic> botSessionDiagnostic()
    {
        return ApiResponse.ok(sessions.inspectSearchBotSession());
    }

    /**
     * Starts the on-demand TDLib client; no account number or message is sent by
     * this operation.
     */
    @PostMapping("/session/start")
    @PreAuthorize("@access.has('telegram:connect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> start()
    {
        return ApiResponse.ok(sessions.start());
    }

    /** Submits the phone number only after the active TDLib session asks for it. */
    @PostMapping("/session/phone")
    @PreAuthorize("@access.has('telegram:connect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> submitPhoneNumber(
            @Valid @RequestBody TelegramPhoneRequest request)
    {
        return ApiResponse.ok(sessions.submitPhoneNumber(request.getValue()));
    }

    /**
     * Submits a one-time login code; it is not stored in the database or browser
     * persistence.
     */
    @PostMapping("/session/code")
    @PreAuthorize("@access.has('telegram:connect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> submitCode(
            @Valid @RequestBody TelegramSensitiveValueRequest request)
    {
        return ApiResponse.ok(sessions.submitCode(request.getValue()));
    }

    /**
     * Submits the two-step verification password; request objects redact their
     * value when rendered.
     */
    @PostMapping("/session/password")
    @PreAuthorize("@access.has('telegram:connect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> submitPassword(
            @Valid @RequestBody TelegramSensitiveValueRequest request)
    {
        return ApiResponse.ok(sessions.submitPassword(request.getValue()));
    }

    /** Submits an email address only for an active Telegram email challenge. */
    @PostMapping("/session/email")
    @PreAuthorize("@access.has('telegram:connect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> submitEmailAddress(
            @Valid @RequestBody TelegramSensitiveValueRequest request)
    {
        return ApiResponse.ok(sessions.submitEmailAddress(request.getValue()));
    }

    /**
     * Submits an email verification code only for an active Telegram email-code
     * challenge.
     */
    @PostMapping("/session/email-code")
    @PreAuthorize("@access.has('telegram:connect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> submitEmailCode(
            @Valid @RequestBody TelegramSensitiveValueRequest request)
    {
        return ApiResponse.ok(sessions.submitEmailCode(request.getValue()));
    }

    /**
     * Completes the registration challenge if Telegram requires a profile display
     * name.
     */
    @PostMapping("/session/register")
    @PreAuthorize("@access.has('telegram:connect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> register(
            @Valid @RequestBody TelegramRegistrationRequest request)
    {
        return ApiResponse.ok(sessions.register(request.firstName(), request.lastName()));
    }

    /**
     * Closes the local client while preserving the encrypted authorization session
     * for later reconnection.
     */
    @PostMapping("/session/close")
    @PreAuthorize("@access.has('telegram:disconnect')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> close()
    {
        return ApiResponse.ok(sessions.close());
    }

    /**
     * Explicitly logs out of Telegram and invalidates the reusable local
     * authorization session.
     */
    @PostMapping("/session/logout")
    @PreAuthorize("@access.has('telegram:logout')")
    public ApiResponse<TelegramSessionCoordinator.TelegramStatusView> logOut()
    {
        return ApiResponse.ok(sessions.logOut());
    }
}
