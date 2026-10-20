package com.mayday.agentscope;

import com.mayday.agentscope.mapper.AgentScopeConversationMapper;
import com.mayday.agentscope.mapper.AgentScopeMessageMapper;
import com.mayday.common.ModuleSwitches;
import com.mayday.common.PageResult;
import com.mayday.common.ServiceUnavailableException;
import com.mayday.security.AccessPolicy;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Authenticated application boundary for a private AgentScope assistant with no access to platform
 * data.
 */
@Service
@RequiredArgsConstructor
public class AgentScopeService {
  private static final String COMPLETE = "COMPLETE";

  private final AgentScopeConversationMapper conversations;
  private final AgentScopeMessageMapper messages;
  private final AgentScopeConversationCoordinator coordinator;
  private final AgentScopeRuntime runtime;
  private final AgentScopeSettings settings;
  private final AgentScopeConfigurationService configuration;
  private final AgentScopeModuleGuard moduleGuard;
  private final ModuleSwitches modules;
  private final AccessPolicy access;

  /**
   * Returns only non-secret deployment readiness and the limits applied to this account's requests.
   */
  public AgentScopeDtos.StatusView status() {
    moduleGuard.requireEnabled();
    access.require("agentscope:view");
    AgentScopeOptions options = configuration.current();
    return new AgentScopeDtos.StatusView(
        modules.isEnabled("agentscope"),
        options.modelReady(),
        settings.getVersion(),
        options.requestTimeoutSeconds(),
        options.maxMessageLength(),
        options.effectiveContextMessageCount());
  }

  /**
   * Paginates conversations strictly by the authenticated owner, never by a caller-supplied user
   * ID.
   */
  public PageResult<AgentScopeDtos.ConversationView> conversations(int page, int size) {
    moduleGuard.requireEnabled();
    access.require("agentscope:view");
    return PageResult.from(
        conversations
            .findByOwnerIdOrderByUpdatedAtDescIdDesc(
                access.current().getId(), Math.max(1, page), Math.min(100, Math.max(1, size)))
            .map(this::conversationView));
  }

  /** Creates a private blank conversation; no client-selected AgentScope identity is accepted. */
  public AgentScopeDtos.ConversationView createConversation() {
    moduleGuard.requireEnabled();
    access.require("agentscope:create");
    return conversationView(coordinator.createConversation(access.current().getId()));
  }

  /** Returns one page of complete conversation messages after checking ownership of the parent. */
  public PageResult<AgentScopeDtos.MessageView> messages(Long conversationId, int page, int size) {
    moduleGuard.requireEnabled();
    access.require("agentscope:view");
    coordinator.ownedConversation(access.current().getId(), conversationId);
    var result =
        messages.findByConversationIdAndStatusOrderByIdDesc(
            conversationId, COMPLETE, PageResult.request(page, size));
    return PageResult.from(result.map(AgentScopeConversationCoordinator::view));
  }

  /** Executes a model turn outside database transactions, then atomically persists its result. */
  public AgentScopeDtos.TurnView send(
      Long conversationId, AgentScopeDtos.SendMessageRequest request) {
    moduleGuard.requireEnabled();
    access.require("agentscope:view");
    access.require("agentscope:chat");
    AgentScopeOptions options = configuration.current();
    if (request.content().length() > options.maxMessageLength())
      throw new com.mayday.common.BusinessException(
          "消息不能超过 " + options.maxMessageLength() + " 个字符");
    if (!options.modelReady()) throw new ServiceUnavailableException("智能体尚未配置模型服务，请联系系统管理员");

    Long ownerId = access.current().getId();
    String requestId = UUID.fromString(request.requestId()).toString();
    AgentScopeConversationCoordinator.TurnStart start =
        coordinator.beginTurn(ownerId, conversationId, requestId, request.content());
    if (start.completed() != null) return start.completed();

    try {
      String answer =
          runtime.reply(
              ownerId, start.conversation().getSessionId(), start.history(), request.content());
      return coordinator.completeTurn(
          ownerId, conversationId, requestId, start.leaseToken(), answer);
    } catch (RuntimeException exception) {
      coordinator.failTurn(ownerId, conversationId, requestId, start.leaseToken());
      throw exception;
    }
  }

  /** Deletes an owned idle conversation and its AgentScope JDBC state. */
  @Transactional
  public void deleteConversation(Long conversationId) {
    moduleGuard.requireEnabled();
    access.require("agentscope:delete");
    Long ownerId = access.current().getId();
    AgentScopeConversation conversation =
        coordinator.conversationForDeletion(ownerId, conversationId);
    runtime.clearState(ownerId, conversation.getSessionId());
    conversations.delete(conversation);
  }

  /**
   * Erases the user's AgentScope state and conversation index during an already-authorized account
   * deletion.
   */
  public void deleteAccountData(Long ownerId) {
    runtime.clearUserState(ownerId);
    conversations.deleteByOwnerId(ownerId);
  }

  private AgentScopeDtos.ConversationView conversationView(AgentScopeConversation conversation) {
    return new AgentScopeDtos.ConversationView(
        conversation.getId(),
        conversation.getTitle(),
        conversation.getCreatedAt(),
        conversation.getUpdatedAt(),
        conversation.getLastMessageAt());
  }
}
