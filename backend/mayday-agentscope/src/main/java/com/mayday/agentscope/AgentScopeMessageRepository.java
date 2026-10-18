package com.mayday.agentscope;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Message persistence with bounded context reads and idempotency lookup scoped to one conversation.
 */
public interface AgentScopeMessageRepository extends JpaRepository<AgentScopeMessage, Long> {
  /**
   * Paginates only complete turns, newest first; the UI reverses the current page for chronology.
   */
  Page<AgentScopeMessage> findByConversationIdAndStatusOrderByIdDesc(
      Long conversationId, String status, Pageable pageable);

  /** Loads a bounded tail of successful history for the next model call. */
  List<AgentScopeMessage> findTop100ByConversationIdAndStatusOrderByIdDesc(
      Long conversationId, String status);

  /**
   * Finds a retry by its client idempotency key without allowing a cross-conversation collision.
   */
  Optional<AgentScopeMessage> findByConversationIdAndTurnTokenAndRole(
      Long conversationId, String turnToken, String role);
}
