package com.mayday.agentscope;

import jakarta.persistence.LockModeType;
import java.time.LocalDateTime;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Private conversation queries. Every user-facing lookup includes the authenticated owner ID. */
public interface AgentScopeConversationRepository
    extends JpaRepository<AgentScopeConversation, Long> {
  /** Lists a single user's conversations in stable most-recent-first order. */
  Page<AgentScopeConversation> findByOwnerIdOrderByUpdatedAtDescIdDesc(
      Long ownerId, Pageable pageable);

  /** Resolves a guessed ID only when it belongs to the requesting account. */
  Optional<AgentScopeConversation> findByIdAndOwnerId(Long id, Long ownerId);

  /** Locks an owned conversation while its session state and database history are erased. */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query(
      "select conversation from AgentScopeConversation conversation where conversation.id = :id and conversation.ownerId = :ownerId")
  Optional<AgentScopeConversation> lockByIdAndOwnerId(
      @Param("id") Long id, @Param("ownerId") Long ownerId);

  /**
   * Atomically grants a distributed per-conversation execution lease or takes over an expired
   * lease.
   */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query(
      value =
          "UPDATE ai_agent_conversation SET processing_token = :leaseToken, processing_request_id = :requestId, processing_started_at = :startedAt, updated_at = :startedAt "
              + "WHERE id = :id AND owner_id = :ownerId AND (processing_token IS NULL OR processing_started_at < :expiredAt)",
      nativeQuery = true)
  int claimProcessing(
      @Param("id") Long id,
      @Param("ownerId") Long ownerId,
      @Param("leaseToken") String leaseToken,
      @Param("requestId") String requestId,
      @Param("startedAt") LocalDateTime startedAt,
      @Param("expiredAt") LocalDateTime expiredAt);

  /**
   * Releases only the lease owned by this request; a late model response cannot clear a newer
   * lease.
   */
  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query(
      value =
          "UPDATE ai_agent_conversation SET processing_token = NULL, processing_request_id = NULL, processing_started_at = NULL "
              + "WHERE id = :id AND owner_id = :ownerId AND processing_token = :token",
      nativeQuery = true)
  int releaseProcessing(
      @Param("id") Long id, @Param("ownerId") Long ownerId, @Param("token") String token);

  /** Removes database history during user erasure; physical session state is cleared separately. */
  long deleteByOwnerId(Long ownerId);
}
