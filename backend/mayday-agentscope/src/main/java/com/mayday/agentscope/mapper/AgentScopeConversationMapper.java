package com.mayday.agentscope.mapper;

import com.mayday.agentscope.AgentScopeConversation;
import com.mayday.common.persistence.EntityMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.time.LocalDateTime;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** Private conversation queries. Every user-facing lookup includes the authenticated owner ID. */
@Mapper
public interface AgentScopeConversationMapper extends EntityMapper<AgentScopeConversation> {
  /** Lists a single user's conversations in stable most-recent-first order. */
  default com.mybatisflex.core.paginate.Page<AgentScopeConversation>
      findByOwnerIdOrderByUpdatedAtDescIdDesc(Long ownerId, int pageNumber, int pageSize) {
    return paginate(
        pageNumber,
        pageSize,
        QueryWrapper.create()
            .where(new QueryColumn("owner_id").eq(ownerId))
            .orderBy("updated_at desc, id desc"));
  }

  /** Resolves a guessed ID only when it belongs to the requesting account. */
  default Optional<AgentScopeConversation> findByIdAndOwnerId(Long id, Long ownerId) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("id").eq(id))
                .and(new QueryColumn("owner_id").eq(ownerId))));
  }

  /** Locks an owned conversation while its session state and database history are erased. */
  default Optional<AgentScopeConversation> lockByIdAndOwnerId(Long id, Long ownerId) {
    return Optional.ofNullable(
        selectOneByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("id").eq(id))
                .and(new QueryColumn("owner_id").eq(ownerId))
                .forUpdate()));
  }

  /**
   * Atomically grants a distributed per-conversation execution lease or takes over an expired
   * lease.
   */
  default int claimProcessing(
      Long id,
      Long ownerId,
      String leaseToken,
      String requestId,
      LocalDateTime startedAt,
      LocalDateTime expiredAt) {
    return Db.updateBySql(
        "update ai_agent_conversation set processing_token = ?, processing_request_id = ?,"
            + " processing_started_at = ?, updated_at = ?"
            + " where id = ? and owner_id = ?"
            + " and (processing_token is null or processing_started_at < ?)",
        leaseToken,
        requestId,
        startedAt,
        startedAt,
        id,
        ownerId,
        expiredAt);
  }

  /**
   * Releases only the lease owned by this request; a late model response cannot clear a newer
   * lease.
   */
  default int releaseProcessing(Long id, Long ownerId, String token) {
    return Db.updateBySql(
        "update ai_agent_conversation set processing_token = null, processing_request_id = null,"
            + " processing_started_at = null where id = ? and owner_id = ? and processing_token = ?",
        id,
        ownerId,
        token);
  }

  /** Removes database history during user erasure; physical session state is cleared separately. */
  default long deleteByOwnerId(Long ownerId) {
    return deleteByQuery(QueryWrapper.create().where(new QueryColumn("owner_id").eq(ownerId)));
  }
}
