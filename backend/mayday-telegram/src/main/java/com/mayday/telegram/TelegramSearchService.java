package com.mayday.telegram;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.concurrent.CompletionException;

import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.persistence.PageResult;
import com.mayday.common.util.BusinessTime;
import com.mayday.security.AccessPolicy;
import com.mayday.telegram.TelegramSearchContracts.CallbackAnswerView;
import com.mayday.telegram.TelegramSearchContracts.MessageView;
import com.mayday.telegram.TelegramSearchContracts.ParsedMessageView;
import com.mayday.telegram.TelegramSearchContracts.SearchView;
import com.mayday.telegram.mapper.TelegramAccountMapper;
import com.mayday.telegram.mapper.TelegramSearchMapper;
import com.mayday.telegram.mapper.TelegramSearchMessageMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
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
 * Only explicit Telegram reply-to relationships complete a search; unmatched
 * messages remain visible as unmatched.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TelegramSearchService
{
    private static final int MESSAGE_PAGE_SIZE = 30;
    private static final int SEARCH_WAIT_SECONDS = 120;

    private final TelegramModuleGuard moduleGuard;
    private final TelegramSettings settings;
    private final AccessPolicy access;
    private final TelegramSessionCoordinator sessions;
    private final TelegramAccountMapper accounts;
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
        search = searches.save(search);

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
            TelegramCallbackAnswer answer = client
                    .activateCallback(message.getBotChatId(), message.getTelegramMessageId(), callbackData).join();
            return new CallbackAnswerView(answer.text(), answer.showAlert(), answer.url());
        } catch (CompletionException exception)
        {
            throw new BusinessException("Telegram 按钮请求未能完成，请检查账号连接或机器人状态");
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
        QueryWrapper filter = access.filter("telegram", "owner_id").and(new QueryColumn("search_id").isNull());
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
        TelegramSearchMessage entity = messages.findMessage(snapshot.chatId(), snapshot.messageId())
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
            searches.findBySentMessage(snapshot.chatId(), snapshot.messageId()).ifPresent(search -> {
                entity.setOwnerId(search.getOwnerId());
                entity.setSearchId(search.getId());
                entity.setDepartmentId(search.getDepartmentId());
                entity.setAssociationStatus("MATCHED");
            });
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
        } else if (previouslyMatchedSearchId != null)
        {
            // An edit/content update for the same Telegram message has no new
            // reply-to edge. Preserve the already verified association rather than
            // downgrading this message to an unrelated inbox item.
            searches.findById(previouslyMatchedSearchId).ifPresent(search -> {
                entity.setOwnerId(search.getOwnerId());
                entity.setSearchId(search.getId());
                entity.setDepartmentId(search.getDepartmentId());
                entity.setAssociationStatus("MATCHED");
                search.setStatus("COMPLETED");
                search.setStatusMessage("机器人更新了与本次查询关联的消息");
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
     * Changes the row to SENDING after the configured bot has been resolved and
     * verified.
     */
    void markSending(Long id, String chatId)
    {
        transactionTemplate.executeWithoutResult(status -> {
            TelegramSearch search = searches.findById(id).orElse(null);
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
            TelegramSearch search = searches.findById(id).orElse(null);
            if (search != null && "SENDING".equals(search.getStatus()))
            {
                search.setBotChatId(chatId);
                search.setSentMessageId(messageId);
                search.setStatus("WAITING");
                search.setExpiresAt(BusinessTime.now().plusSeconds(SEARCH_WAIT_SECONDS));
                search.setStatusMessage("查询已发送，等待机器人回复");
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
            TelegramSearch search = searches.findById(id).orElse(null);
            if (search != null && !"COMPLETED".equals(search.getStatus()))
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

}
