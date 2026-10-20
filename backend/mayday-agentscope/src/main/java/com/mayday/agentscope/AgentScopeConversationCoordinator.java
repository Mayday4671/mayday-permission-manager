package com.mayday.agentscope;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.mayday.agentscope.mapper.AgentScopeConversationMapper;
import com.mayday.agentscope.mapper.AgentScopeMessageMapper;
import com.mayday.common.exception.BusinessException;
import com.mayday.common.exception.ConflictException;
import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.common.util.BusinessTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Short database transactions around long-running model calls; no transaction
 * remains open over the network.
 */
@Service
@RequiredArgsConstructor
public class AgentScopeConversationCoordinator
{
    private static final String USER = "USER";
    private static final String ASSISTANT = "ASSISTANT";
    private static final String PROCESSING = "PROCESSING";
    private static final String COMPLETE = "COMPLETE";
    private static final String FAILED = "FAILED";

    private final AgentScopeConversationMapper conversations;
    private final AgentScopeMessageMapper messages;
    private final AgentScopeSettings settings;

    /** Maps internal status fields to a narrowly scoped public response. */
    public static AgentScopeDtos.MessageView view(AgentScopeMessage message)
    {
        return new AgentScopeDtos.MessageView(message.getId(), message.getRole(), message.getContent(),
                message.getStatus(), message.getCreatedAt());
    }

    /**
     * Creates a random, owner-bound empty session; client input cannot choose the
     * AgentScope state key.
     */
    @Transactional
    public AgentScopeConversation createConversation(Long ownerId)
    {
        AgentScopeConversation conversation = new AgentScopeConversation();
        conversation.setOwnerId(ownerId);
        conversation.setSessionId(UUID.randomUUID().toString());
        conversation.setTitle("新会话");
        return conversations.save(conversation);
    }

    /**
     * Claims a cross-instance lease and writes the pending user turn in one short
     * transaction. A completed retry returns its original result; an active request
     * is rejected instead of invoking the model twice. Lease tokens differ from
     * client idempotency keys so an expired invocation cannot commit after a retry
     * has taken over.
     */
    @Transactional
    public TurnStart beginTurn(Long ownerId, Long conversationId, String requestId, String content)
    {
        AgentScopeConversation conversation = ownedConversation(ownerId, conversationId);
        Optional<AgentScopeMessage> previous = messages.findByConversationIdAndTurnTokenAndRole(conversationId,
                requestId, USER);
        if (previous.isPresent() && COMPLETE.equals(previous.get().getStatus()))
        {
            AgentScopeMessage assistant = messages
                    .findByConversationIdAndTurnTokenAndRole(conversationId, requestId, ASSISTANT)
                    .orElseThrow(() -> new ConflictException("该请求已完成，但回复记录暂不可用，请刷新会话"));
            return TurnStart.completed(conversation, previous.get(), assistant);
        }
        if (previous.isPresent() && !previous.get().getContent().equals(content))
        {
            throw new BusinessException("重试消息内容与原请求不同，请重新发送");
        }

        LocalDateTime now = BusinessTime.now();
        LocalDateTime expiredAt = now.minusSeconds(settings.getRequestTimeoutSeconds() + 60L);
        String leaseToken = UUID.randomUUID().toString();
        String expiredRequestId = conversation.getProcessingRequestId();
        if (conversations.claimProcessing(conversationId, ownerId, leaseToken, requestId, now, expiredAt) == 0)
        {
            throw new ConflictException("当前会话已有一条消息正在处理，请稍后重试");
        }

        conversation = ownedConversation(ownerId, conversationId);
        if (expiredRequestId != null && !expiredRequestId.equals(requestId))
        {
            messages.findByConversationIdAndTurnTokenAndRole(conversationId, expiredRequestId, USER)
                    .filter(message -> PROCESSING.equals(message.getStatus())).ifPresent(staleMessage -> {
                        staleMessage.setStatus(FAILED);
                        messages.save(staleMessage);
                    });
        }
        AgentScopeMessage userMessage = previous.map(old -> {
            AgentScopeMessage retry = messages.findByConversationIdAndTurnTokenAndRole(conversationId, requestId, USER)
                    .orElseThrow();
            retry.setStatus(PROCESSING);
            return messages.save(retry);
        }).orElseGet(() -> saveUserMessage(conversationId, requestId, content));
        if ("新会话".equals(conversation.getTitle()))
        {
            conversation.setTitle(content.strip().replaceAll("\\s+", " ").substring(0,
                    Math.min(60, content.strip().replaceAll("\\s+", " ").length())));
        }
        conversations.save(conversation);

        List<AgentScopeMessage> history = messages
                .findTop100ByConversationIdAndStatusOrderByIdDesc(conversationId, COMPLETE).stream()
                .filter(message -> !requestId.equals(message.getTurnToken()))
                .limit(settings.effectiveContextMessageCount())
                .sorted((left, right) -> Long.compare(left.getId(), right.getId())).toList();
        return TurnStart.pending(conversation, userMessage, history, leaseToken);
    }

    /**
     * Saves both sides of a turn only while its fencing token still owns the
     * distributed lease.
     */
    @Transactional
    public AgentScopeDtos.TurnView completeTurn(Long ownerId, Long conversationId, String requestId, String leaseToken,
            String answer)
    {
        AgentScopeConversation conversation = ownedConversation(ownerId, conversationId);
        if (!leaseToken.equals(conversation.getProcessingToken())
                || !requestId.equals(conversation.getProcessingRequestId()))
        {
            throw new ConflictException("会话处理租约已更新，旧请求结果已丢弃");
        }
        AgentScopeMessage userMessage = messages
                .findByConversationIdAndTurnTokenAndRole(conversationId, requestId, USER)
                .orElseThrow(() -> new ConflictException("找不到正在处理的用户消息"));
        if (!PROCESSING.equals(userMessage.getStatus()))
        {
            throw new ConflictException("用户消息状态已变化，请刷新会话");
        }
        userMessage.setStatus(COMPLETE);
        messages.save(userMessage);

        AgentScopeMessage assistantMessage = new AgentScopeMessage();
        assistantMessage.setConversationId(conversationId);
        assistantMessage.setTurnToken(requestId);
        assistantMessage.setRole(ASSISTANT);
        assistantMessage.setContent(answer);
        assistantMessage.setStatus(COMPLETE);
        messages.save(assistantMessage);
        conversation.setLastMessageAt(BusinessTime.now());
        conversation.setProcessingToken(null);
        conversation.setProcessingRequestId(null);
        conversation.setProcessingStartedAt(null);
        conversations.save(conversation);
        return new AgentScopeDtos.TurnView(view(userMessage), view(assistantMessage));
    }

    /**
     * Marks a failed prompt as retryable and releases only this request's lease.
     */
    @Transactional
    public void failTurn(Long ownerId, Long conversationId, String requestId, String leaseToken)
    {
        AgentScopeConversation conversation = ownedConversation(ownerId, conversationId);
        if (!leaseToken.equals(conversation.getProcessingToken())
                || !requestId.equals(conversation.getProcessingRequestId()))
        {
            return;
        }
        messages.findByConversationIdAndTurnTokenAndRole(conversationId, requestId, USER)
                .filter(message -> PROCESSING.equals(message.getStatus())).ifPresent(message -> {
                    message.setStatus(FAILED);
                    messages.save(message);
                });
        conversations.releaseProcessing(conversationId, ownerId, leaseToken);
    }

    /**
     * Rejects removal while a valid lease exists and otherwise returns the private
     * session identifiers.
     */
    @Transactional
    public AgentScopeConversation conversationForDeletion(Long ownerId, Long conversationId)
    {
        AgentScopeConversation conversation = conversations.lockByIdAndOwnerId(conversationId, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("会话不存在"));
        if (conversation.getProcessingToken() != null && conversation.getProcessingStartedAt() != null
                && conversation.getProcessingStartedAt()
                        .isAfter(BusinessTime.now().minusSeconds(settings.getRequestTimeoutSeconds() + 60L)))
        {
            throw new ConflictException("会话正在处理消息，完成后再删除");
        }
        return conversation;
    }

    /**
     * Loads a conversation only inside its owner's boundary; the same result is
     * used before every write.
     */
    @Transactional(readOnly = true)
    public AgentScopeConversation ownedConversation(Long ownerId, Long conversationId)
    {
        return conversations.findByIdAndOwnerId(conversationId, ownerId)
                .orElseThrow(() -> new ResourceNotFoundException("会话不存在"));
    }

    private AgentScopeMessage saveUserMessage(Long conversationId, String requestId, String content)
    {
        AgentScopeMessage message = new AgentScopeMessage();
        message.setConversationId(conversationId);
        message.setTurnToken(requestId);
        message.setRole(USER);
        message.setContent(content);
        message.setStatus(PROCESSING);
        return messages.save(message);
    }

    /**
     * Immutable handoff from the lease transaction to the network-bound AgentScope
     * runtime.
     */
    public record TurnStart(AgentScopeConversation conversation, AgentScopeMessage userMessage,
            List<AgentScopeMessage> history, AgentScopeDtos.TurnView completed, String leaseToken) {
        /** Returns a pending turn that may safely call the external model. */
        public static TurnStart pending(AgentScopeConversation conversation, AgentScopeMessage userMessage,
                List<AgentScopeMessage> history, String leaseToken)
        {
            return new TurnStart(conversation, userMessage, List.copyOf(history), null, leaseToken);
        }

        /** Returns the previously persisted turn for an idempotent network retry. */
        public static TurnStart completed(AgentScopeConversation conversation, AgentScopeMessage user,
                AgentScopeMessage assistant)
        {
            return new TurnStart(conversation, user, List.of(),
                    new AgentScopeDtos.TurnView(view(user), view(assistant)), null);
        }
    }
}
