package com.mayday.telegram;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletionException;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.persistence.PageResult;
import com.mayday.common.util.BusinessTime;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.TelegramSearchContracts.CallbackAnswerView;
import com.mayday.telegram.TelegramSearchContracts.ConversationMessageView;
import com.mayday.telegram.TelegramSearchContracts.ConversationTurnView;
import com.mayday.telegram.TelegramSearchContracts.MessageView;
import com.mayday.telegram.TelegramSearchContracts.ParsedMessageView;
import com.mayday.telegram.TelegramSearchContracts.SearchView;
import com.mayday.telegram.mapper.TelegramAccountMapper;
import com.mayday.telegram.mapper.TelegramConversationMapper;
import com.mayday.telegram.mapper.TelegramSearchMapper;
import com.mayday.telegram.mapper.TelegramSearchMessageMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Runs the deliberate search workflow and stores a bounded, owner-scoped
 * projection of the configured bot chat.
 *
 * <p>
 * Telegram reply-to relationships are preferred. Some bots do not set reply-to
 * metadata, so an incoming message can also complete the sole unexpired search
 * in that verified bot chat; the inferred association is stored separately.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TelegramSearchService
{
    private static final Logger LOGGER = LoggerFactory.getLogger(TelegramSearchService.class);

    private static final int MESSAGE_PAGE_SIZE = 30;
    private static final int SEARCH_WAIT_SECONDS = 120;

    private final TelegramModuleGuard moduleGuard;
    private final TelegramSettings settings;
    private final AccessPolicy access;
    private final TelegramSessionCoordinator sessions;
    private final TelegramAccountMapper accounts;
    private final TelegramConversationMapper conversations;
    private final TelegramSearchMapper searches;
    private final TelegramSearchMessageMapper messages;
    private final TelegramResultParser resultParser;
    private final TransactionTemplate transactionTemplate;

    /**
     * Persists intent before sending, then updates the row asynchronously from
     * TDLib completions.
     */
    @Transactional
    public SearchView create(String keyword)
    {
        return create(keyword, null);
    }

    /**
     * Creates one search turn inside the caller's conversation. When an older API
     * client omits the conversation ID, the most recently used conversation owned
     * by the caller is reused; a new one is created only when none exists.
     */
    @Transactional
    public SearchView create(String keyword, Long conversationId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:search");
        String normalized = keyword == null ? "" : keyword.trim();
        if (normalized.isBlank() || normalized.length() > 256)
        {
            throw new IllegalArgumentException("搜索关键词必须为 1 到 256 个字符");
        }
        String verifiedBotUsername;
        try
        {
            verifiedBotUsername = TelegramBotUsername.normalize(settings.getSearchBotUsername());
        } catch (IllegalArgumentException exception)
        {
            throw new BusinessException("服务端配置的 Telegram 搜索机器人用户名无效");
        }
        TelegramSessionClient client = sessions.requireReadyClient("telegram:search");
        access.checkData("telegram", access.current().getId(), access.current().getDepartmentId());
        TelegramConversation conversation = conversationId == null
                ? currentConversationOrCreate()
                : visibleConversation(conversationId);
        LocalDateTime now = BusinessTime.now();
        QueryWrapper active = QueryWrapper.create().where(new QueryColumn("status").in("PENDING", "SENDING", "WAITING"))
                .and(new QueryColumn("expires_at").gt(now));
        if (searches.selectCountByQuery(active) > 0)
        {
            throw new IllegalStateException("上一条搜索仍在等待机器人回复；请等待完成或超时后再搜索");
        }
        TelegramSearch search = new TelegramSearch();
        search.setOwnerId(access.current().getId());
        search.setDepartmentId(access.current().getDepartmentId());
        search.setKeyword(normalized);
        search.setBotUsername(verifiedBotUsername);
        search.setStatus("PENDING");
        search.setParseStatus("UNKNOWN");
        search.setExpiresAt(now.plusSeconds(SEARCH_WAIT_SECONDS));
        search.setStatusMessage("已创建，正在连接已配置的搜索机器人");
        search.setConversationId(conversation.getId());
        search = searches.save(search);

        updateConversationPreview(conversation, normalized);

        Long searchId = search.getId();
        Runnable sendAfterCommit = () -> client.resolveBot(verifiedBotUsername).thenCompose(bot -> {
            markSending(searchId, bot.chatId());
            return client.sendSearchText(bot.chatId(), normalized).thenApply(messageId -> {
                markWaiting(searchId, bot.chatId(), messageId);
                return messageId;
            });
        }).whenComplete((ignored, error) -> {
            if (error != null)
            {
                markFailed(searchId);
            }
        });
        if (TransactionSynchronizationManager.isSynchronizationActive())
        {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit()
                {
                    sendAfterCommit.run();
                }
            });
        } else
        {
            sendAfterCommit.run();
        }
        return SearchView.from(search);
    }

    /** Creates and returns an empty conversation for the authenticated user. */
    @Transactional
    public TelegramConversationView createConversation()
    {
        moduleGuard.requireEnabled();
        access.require("telegram:search");
        access.checkData("telegram", access.current().getId(), access.current().getDepartmentId());
        return TelegramConversationView.from(createConversationEntity());
    }

    /**
     * Returns a bounded, most-recent-first list of conversations visible to the
     * caller.
     */
    public PageResult<TelegramConversationView> listConversations(int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        return PageResult.of(conversations.paginate(PageResult.request(page, Math.min(size, 50)),
                access.filter("telegram", "owner_id").and(new QueryColumn("owner_id").eq(access.current().getId()))
                        .orderBy(new QueryColumn("updated_at").desc(), new QueryColumn("id").desc())),
                TelegramConversationView::from);
    }

    /**
     * Deletes one idle conversation and all search/message snapshots grouped in it.
     * A pending bot request prevents deletion until it completes or times out, so
     * an asynchronous Telegram reply cannot recreate data after the user deletes
     * it.
     */
    @Transactional
    public void deleteConversation(Long conversationId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:delete");
        TelegramConversation conversation = visibleConversation(conversationId);
        QueryWrapper searchFilter = access.filter("telegram", "owner_id")
                .and(new QueryColumn("owner_id").eq(access.current().getId()))
                .and(new QueryColumn("conversation_id").eq(conversation.getId()));
        List<TelegramSearch> conversationSearches = searches.selectListByQuery(searchFilter);
        boolean hasPendingSearch = conversationSearches.stream()
                .anyMatch(search -> List.of("PENDING", "SENDING", "WAITING").contains(search.getStatus())
                        && search.getExpiresAt() != null && search.getExpiresAt().isAfter(BusinessTime.now()));
        if (hasPendingSearch)
        {
            throw new BusinessException("会话中仍有搜索正在等待机器人回复，请完成或超时后再删除");
        }
        if (!conversationSearches.isEmpty())
        {
            List<Long> searchIds = conversationSearches.stream().map(TelegramSearch::getId).toList();
            messages.deleteByQuery(QueryWrapper.create().where(new QueryColumn("search_id").in(searchIds)));
            searches.deleteByQuery(QueryWrapper.create().where(new QueryColumn("id").in(searchIds))
                    .and(new QueryColumn("conversation_id").eq(conversation.getId())));
        }
        conversations.deleteById(conversation.getId());
    }

    /**
     * Returns the caller's visible searches with all range filtering performed in
     * SQL.
     */
    public PageResult<SearchView> list(int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        QueryWrapper filter = access.filter("telegram", "owner_id");
        return PageResult.of(
                searches.paginate(PageResult.request(page, size), filter.orderBy(new QueryColumn("id").desc())),
                SearchView::from);
    }

    /**
     * Returns recent searches as conversation turns, with each bot reply and its
     * parsed links in the same message projection. Search rows remain separate
     * internally for auditability and Telegram correlation, but are not presented
     * as separate conversations to the user.
     *
     * <p>
     * The search page is capped at twenty turns. Messages are fetched in one
     * owner-scoped query for that page, preventing an N+1 request pattern and
     * ensuring replies cannot be mixed across owners or search IDs. Only incoming
     * messages explicitly associated with a search appear here; uncertain updates
     * remain in the separate unmatched-message view.
     */
    public PageResult<ConversationTurnView> listConversation(Long conversationId, int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        TelegramConversation conversation = visibleConversation(conversationId);

        var searchPage = searches.paginate(PageResult.request(page, Math.min(size, 20)),
                access.filter("telegram", "owner_id").and(new QueryColumn("owner_id").eq(access.current().getId()))
                        .and(new QueryColumn("conversation_id").eq(conversation.getId()))
                        .orderBy(new QueryColumn("id").desc()));
        List<TelegramSearch> searchRows = searchPage.getRecords();
        Map<Long, List<ConversationMessageView>> messagesBySearchId = new HashMap<>();

        if (!searchRows.isEmpty())
        {
            List<Long> searchIds = searchRows.stream().map(TelegramSearch::getId).toList();
            List<TelegramSearchMessage> messageRows = messages.selectListByQuery(
                    access.filter("telegram", "owner_id").and(new QueryColumn("owner_id").eq(access.current().getId()))
                            .and(new QueryColumn("search_id").in(searchIds)).and(new QueryColumn("outgoing").eq(false))
                            .orderBy(new QueryColumn("telegram_sent_at").asc(), new QueryColumn("id").asc()));

            for (TelegramSearchMessage message : messageRows)
            {
                messagesBySearchId.computeIfAbsent(message.getSearchId(), ignored -> new ArrayList<>())
                        .add(ConversationMessageView.from(message, resultParser));
            }
        }

        return PageResult.of(searchPage, search -> new ConversationTurnView(SearchView.from(search),
                messagesBySearchId.getOrDefault(search.getId(), List.of())));
    }

    /**
     * Reads one search only after checking both action permission and
     * owner/departments data scope.
     */
    public SearchView get(Long searchId)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        return SearchView.from(visibleSearch(searchId));
    }

    /**
     * Returns one search's bot messages in a separately paginated, range-filtered
     * projection.
     */
    public PageResult<MessageView> listMessages(Long searchId, int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        TelegramSearch search = visibleSearch(searchId);
        QueryWrapper filter = access.filter("telegram", "owner_id")
                .and(new QueryColumn("search_id").eq(search.getId()));
        return PageResult.of(
                messages.paginate(PageResult.request(page, Math.min(size, MESSAGE_PAGE_SIZE)),
                        filter.orderBy(new QueryColumn("telegram_sent_at").asc(), new QueryColumn("id").asc())),
                MessageView::from);
    }

    /**
     * Returns bounded link candidates from messages explicitly associated with one
     * visible search. Candidates remain tied to their original bot message for
     * verification and do not trigger collection or external requests.
     */
    public PageResult<ParsedMessageView> listParsedMessages(Long searchId, int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        TelegramSearch search = visibleSearch(searchId);
        QueryWrapper filter = access.filter("telegram", "owner_id").and(new QueryColumn("search_id").eq(search.getId()))
                .and(new QueryColumn("outgoing").eq(false));
        return PageResult.of(
                messages.paginate(PageResult.request(page, Math.min(size, MESSAGE_PAGE_SIZE)),
                        filter.orderBy(new QueryColumn("telegram_sent_at").asc(), new QueryColumn("id").asc())),
                entity -> ParsedMessageView.from(entity, resultParser));
    }

    /**
     * Activates one callback button that was previously captured from a message
     * belonging to this visible search. The browser supplies only row/column
     * indexes; callback bytes and Telegram identifiers come from server-side
     * records.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public CallbackAnswerView activateCallback(Long searchId, Long messageId, int rowIndex, int columnIndex)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:search");
        TelegramSearch search = visibleSearch(searchId);
        TelegramSearchMessage message = messages.selectOneByQuery(QueryWrapper.create()
                .where(new QueryColumn("id").eq(messageId)).and(new QueryColumn("search_id").eq(search.getId()))
                .and(new QueryColumn("bot_chat_id").eq(search.getBotChatId()))
                .and(new QueryColumn("outgoing").eq(false)));
        if (message == null)
        {
            throw new ResourceNotFoundException("可执行的机器人消息不存在");
        }
        access.checkData("telegram", message.getOwnerId(), message.getDepartmentId());
        byte[] callbackData = TelegramInlineKeyboard.requireCallbackData(message.getReplyMarkupJson(), rowIndex,
                columnIndex);
        TelegramSessionClient client = sessions.requireReadyClient("telegram:search");
        try
        {
            // A restored user session does not restore the client's verified bot cache.
            // Resolve read-only before using persisted buttons, without resending keywords.
            TelegramBotChat bot = client.resolveBot(TelegramBotUsername.normalize(settings.getSearchBotUsername()))
                    .join();
            if (!Objects.equals(bot.chatId(), message.getBotChatId()))
            {
                throw new BusinessException("当前配置的机器人与这条回复不一致，请重新搜索后使用新回复中的按钮。");
            }
            TelegramCallbackAnswer answer = client
                    .activateCallback(message.getBotChatId(), message.getTelegramMessageId(), callbackData).join();
            return new CallbackAnswerView(answer.text(), answer.showAlert(), answer.url());
        } catch (CompletionException | CancellationException exception)
        {
            String diagnosticLabel = TelegramCallbackFeedback.diagnosticLabel(exception);
            LOGGER.warn("Telegram inline button activation failed ({})", diagnosticLabel);
            throw new BusinessException(TelegramCallbackFeedback.failed(exception));
        } finally
        {
            java.util.Arrays.fill(callbackData, (byte) 0);
        }
    }

    /**
     * Displays bot-chat updates whose relationship to a submitted search is not
     * confirmed.
     */
    public PageResult<MessageView> listUnmatchedMessages(int page, int size)
    {
        moduleGuard.requireEnabled();
        access.require("telegram:view");
        QueryWrapper filter = access.filter("telegram", "owner_id").and(new QueryColumn("search_id").isNull())
                .and(new QueryColumn("outgoing").eq(false));
        return PageResult.of(
                messages.paginate(PageResult.request(page, Math.min(size, MESSAGE_PAGE_SIZE)),
                        filter.orderBy(new QueryColumn("telegram_sent_at").desc(), new QueryColumn("id").desc())),
                MessageView::from);
    }

    /**
     * Stores each allow-listed TDLib update idempotently and links only explicit
     * bot replies.
     */
    @Transactional
    @EventListener
    public void onMessage(TelegramMessageSnapshot snapshot)
    {
        moduleGuard.requireEnabled();
        TelegramAccount account = accounts.findPrimary().orElse(null);
        if (account == null || snapshot.chatId() == null)
        {
            return;
        }
        TelegramSearchMessage entity = messages
                .findMessageForUpdate(snapshot.chatId(), snapshot.messageId(), snapshot.previousMessageId())
                .orElseGet(TelegramSearchMessage::new);
        Long previouslyMatchedSearchId = entity.getSearchId();
        LocalDateTime incomingEditTime = toBusinessTime(snapshot.editedAtEpochSeconds());
        if (entity.getId() != null && entity.getTelegramEditedAt() != null
                && (incomingEditTime == null || entity.getTelegramEditedAt().isAfter(incomingEditTime)))
        {
            return;
        }
        entity.setOwnerId(account.getOwnerId());
        entity.setDepartmentId(account.getDepartmentId());
        entity.setSearchId(null);
        entity.setBotChatId(snapshot.chatId());
        entity.setTelegramMessageId(snapshot.messageId());
        entity.setSenderId(snapshot.senderId());
        entity.setOutgoing(snapshot.outgoing());
        entity.setUpdateType(snapshot.updateType());
        entity.setContentType(snapshot.contentType());
        entity.setMessageText(snapshot.text());
        entity.setEntitiesJson(snapshot.entitiesJson() == null ? "[]" : snapshot.entitiesJson());
        entity.setReplyMarkupJson(snapshot.replyMarkupJson() == null ? "[]" : snapshot.replyMarkupJson());
        entity.setReplyToMessageId(snapshot.replyToMessageId());
        entity.setTelegramSentAt(toBusinessTime(snapshot.sentAtEpochSeconds()));
        entity.setTelegramEditedAt(toBusinessTime(snapshot.editedAtEpochSeconds()));
        entity.setAssociationStatus("UNMATCHED");
        if (snapshot.outgoing())
        {
            String priorMessageId = snapshot.previousMessageId();
            java.util.Optional<TelegramSearch> request = priorMessageId == null
                    ? searches.findBySentMessage(snapshot.chatId(), snapshot.messageId())
                    : searches.findBySentMessage(snapshot.chatId(), priorMessageId);
            if (request.isEmpty() && ("UpdateMessageSendSucceeded".equals(snapshot.updateType())
                    || "UpdateMessageSendFailed".equals(snapshot.updateType())))
            {
                request = searches.findActiveForBot(snapshot.chatId(), BusinessTime.now());
            }
            if (request.isPresent())
            {
                TelegramSearch search = request.get();
                entity.setOwnerId(search.getOwnerId());
                entity.setSearchId(search.getId());
                entity.setDepartmentId(search.getDepartmentId());
                entity.setAssociationStatus("MATCHED");
                if ("UpdateMessageSendSucceeded".equals(snapshot.updateType()))
                {
                    search.setSentMessageId(snapshot.messageId());
                    search.setStatus("WAITING");
                    search.setExpiresAt(BusinessTime.now().plusSeconds(SEARCH_WAIT_SECONDS));
                    search.setStatusMessage("Telegram 已确认发送关键词，正在等待机器人回复");
                    searches.save(search);
                } else if ("UpdateMessageSendFailed".equals(snapshot.updateType()))
                {
                    search.setStatus("FAILED");
                    search.setStatusMessage(sendFailureMessage(snapshot.sendErrorCode(), snapshot.sendErrorName()));
                    searches.save(search);
                }
            }
        } else if (snapshot.replyToMessageId() != null)
        {
            searches.findBySentMessage(snapshot.chatId(), snapshot.replyToMessageId()).ifPresent(search -> {
                entity.setOwnerId(search.getOwnerId());
                entity.setSearchId(search.getId());
                entity.setDepartmentId(search.getDepartmentId());
                entity.setAssociationStatus("MATCHED");
                search.setStatus("COMPLETED");
                search.setParseStatus("UNKNOWN");
                search.setStatusMessage("已收到与本次查询明确关联的机器人回复；内容尚未被解析");
                searches.save(search);
            });
        } else
        {
            java.util.Optional<TelegramSearch> activeSearch = previouslyMatchedSearchId == null
                    ? searches.findActiveForBot(snapshot.chatId(), BusinessTime.now())
                    : searches.findById(previouslyMatchedSearchId);
            activeSearch.ifPresent(search -> {
                entity.setOwnerId(search.getOwnerId());
                entity.setSearchId(search.getId());
                entity.setDepartmentId(search.getDepartmentId());
                entity.setAssociationStatus(previouslyMatchedSearchId == null ? "INFERRED" : "MATCHED");
                search.setStatus("COMPLETED");
                search.setParseStatus("UNKNOWN");
                search.setStatusMessage(
                        previouslyMatchedSearchId == null ? "机器人未提供回复引用；系统将该消息关联到当前唯一待处理查询" : "机器人更新了与本次查询关联的消息");
                searches.save(search);
            });
        }
        messages.save(entity);
        if (entity.getSearchId() != null && !Boolean.TRUE.equals(entity.getOutgoing()))
        {
            searches.findById(entity.getSearchId()).ifPresent(search -> {
                if (!resultParser.parse(entity).isEmpty())
                {
                    search.setParseStatus("PARTIAL");
                    search.setStatusMessage("已识别候选来源链接；请核对原始消息后再决定是否采集");
                    searches.save(search);
                }
            });
        }
    }

    /** Checks the search resource's row scope even when the supplied ID exists. */
    private TelegramSearch visibleSearch(Long id)
    {
        TelegramSearch search = searches.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 搜索记录不存在"));
        access.checkData("telegram", search.getOwnerId(), search.getDepartmentId());
        return search;
    }

    /**
     * Resolves a conversation and enforces its owner and configured department data
     * scope.
     */
    private TelegramConversation visibleConversation(Long id)
    {
        TelegramConversation conversation = conversations.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Telegram 会话不存在"));
        // Conversations contain a user's private Telegram searches. Platform-wide
        // data scopes must not turn them into shared transcripts for other users.
        if (!Objects.equals(access.current().getId(), conversation.getOwnerId()))
        {
            throw new ResourceNotFoundException("Telegram 会话不存在");
        }
        access.checkData("telegram", conversation.getOwnerId(), conversation.getDepartmentId());
        return conversation;
    }

    /**
     * Builds a new-session entity from the authenticated Mayday user's current
     * ownership context.
     */
    private TelegramConversation createConversationEntity()
    {
        TelegramConversation conversation = new TelegramConversation();
        conversation.setOwnerId(access.current().getId());
        conversation.setDepartmentId(access.current().getDepartmentId());
        conversation.setTitle("新会话");
        conversation.setSearchCount(0);
        return conversations.save(conversation);
    }

    /**
     * Reuses the newest owned session for clients predating the conversation-ID
     * field.
     */
    private TelegramConversation currentConversationOrCreate()
    {
        TelegramConversation existing = conversations.selectOneByQuery(
                access.filter("telegram", "owner_id").and(new QueryColumn("owner_id").eq(access.current().getId()))
                        .orderBy(new QueryColumn("updated_at").desc(), new QueryColumn("id").desc()).limit(1));
        return existing == null ? createConversationEntity() : existing;
    }

    /**
     * Updates the sidebar preview and first-turn title inside the search
     * transaction.
     */
    private void updateConversationPreview(TelegramConversation conversation, String keyword)
    {
        if (conversation.getSearchCount() == null || conversation.getSearchCount() == 0)
        {
            conversation.setTitle(keyword.length() <= 60 ? keyword : keyword.substring(0, 60));
        }
        conversation.setLastKeyword(keyword);
        conversation.setSearchCount((conversation.getSearchCount() == null ? 0 : conversation.getSearchCount()) + 1);
        conversations.save(conversation);
    }

    /**
     * Changes the row to SENDING after the configured bot has been resolved and
     * verified.
     */
    void markSending(Long id, String chatId)
    {
        transactionTemplate.executeWithoutResult(status -> {
            TelegramSearch search = searches.lock(id).orElse(null);
            if (search != null && "PENDING".equals(search.getStatus()))
            {
                search.setBotChatId(chatId);
                search.setStatus("SENDING");
                search.setStatusMessage("机器人身份已验证，正在发送关键词");
                searches.save(search);
            }
        });
    }

    /**
     * Persists the actual Telegram outgoing message ID; never assumes an HTTP
     * request ID is a Telegram ID.
     */
    void markWaiting(Long id, String chatId, String messageId)
    {
        transactionTemplate.executeWithoutResult(status -> {
            TelegramSearch search = searches.lock(id).orElse(null);
            if (search != null && ("SENDING".equals(search.getStatus()) || "WAITING".equals(search.getStatus())))
            {
                search.setBotChatId(chatId);
                if (search.getSentMessageId() == null)
                {
                    search.setSentMessageId(messageId);
                }
                search.setStatus("WAITING");
                search.setExpiresAt(BusinessTime.now().plusSeconds(SEARCH_WAIT_SECONDS));
                search.setStatusMessage("请求已交给 Telegram，等待发送确认和机器人回复");
                searches.save(search);
                messages.findMessage(chatId, messageId).ifPresent(outgoing -> {
                    outgoing.setOwnerId(search.getOwnerId());
                    outgoing.setSearchId(search.getId());
                    outgoing.setDepartmentId(search.getDepartmentId());
                    outgoing.setAssociationStatus("MATCHED");
                    messages.save(outgoing);
                });
                for (TelegramSearchMessage reply : messages.findReplies(chatId, messageId))
                {
                    reply.setOwnerId(search.getOwnerId());
                    reply.setSearchId(search.getId());
                    reply.setDepartmentId(search.getDepartmentId());
                    reply.setAssociationStatus("MATCHED");
                    messages.save(reply);
                    search.setStatus("COMPLETED");
                    search.setStatusMessage("已收到与本次查询明确关联的机器人回复；内容尚未被解析");
                    searches.save(search);
                }
            }
        });
    }

    /**
     * Stores a fixed safe failure state without persisting TDLib errors or query
     * details in logs.
     */
    void markFailed(Long id)
    {
        transactionTemplate.executeWithoutResult(status -> {
            TelegramSearch search = searches.lock(id).orElse(null);
            if (search != null && !"COMPLETED".equals(search.getStatus()) && !"FAILED".equals(search.getStatus()))
            {
                search.setStatus("FAILED");
                search.setStatusMessage("搜索机器人未能接受请求，请检查账号连接与机器人配置");
                searches.save(search);
            }
        });
    }

    /**
     * Converts a Unix timestamp without relying on the service host default
     * timezone.
     */
    private LocalDateTime toBusinessTime(Long timestamp)
    {
        return timestamp == null
                ? null
                : LocalDateTime.ofInstant(Instant.ofEpochSecond(timestamp), BusinessTime.zone());
    }

    /**
     * Returns actionable, non-sensitive feedback using a numeric code and a small
     * allow-list of symbolic Telegram errors.
     */
    static String sendFailureMessage(Integer errorCode, String errorName)
    {
        if ("YOU_BLOCKED_USER".equals(errorName))
        {
            return "Telegram 拒绝了关键词发送（YOU_BLOCKED_USER）。请核对 Mayday 当前配置的机器人是否与 Telegram 客户端中使用的机器人一致，再重试；无需重新登录账号。";
        }
        if (Integer.valueOf(429).equals(errorCode))
        {
            return "Telegram 暂时限制了发送频率，请稍后再试";
        }
        if (Integer.valueOf(400).equals(errorCode) || Integer.valueOf(403).equals(errorCode))
        {
            return "Telegram 拒绝了当前绑定账号的发送请求（错误代码 " + errorCode + "）。请检查账号状态、机器人会话和服务端配置";
        }
        return errorCode == null
                ? "Telegram 未能发送关键词；请检查账号连接与机器人状态"
                : "Telegram 未能发送关键词（错误代码 " + errorCode + "）；请检查机器人会话后重试";
    }

}
