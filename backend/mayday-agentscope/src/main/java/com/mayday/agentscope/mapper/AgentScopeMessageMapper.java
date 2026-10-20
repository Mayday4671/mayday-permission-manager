package com.mayday.agentscope.mapper;

import java.util.List;
import java.util.Optional;

import com.mayday.agentscope.AgentScopeMessage;
import com.mayday.common.persistence.EntityMapper;
import com.mybatisflex.core.paginate.Page;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * Message persistence with bounded context reads and idempotency lookup scoped
 * to one conversation.
 */
@Mapper
public interface AgentScopeMessageMapper extends EntityMapper<AgentScopeMessage>
{
    /**
     * Paginates only complete turns, newest first; the UI reverses the current page
     * for chronology.
     */
    default Page<AgentScopeMessage> findByConversationIdAndStatusOrderByIdDesc(Long conversationId, String status,
            Page<AgentScopeMessage> page)
    {
        return paginate(page, QueryWrapper.create().where(new QueryColumn("conversation_id").eq(conversationId))
                .and(new QueryColumn("status").eq(status)).orderBy("id desc"));
    }

    /** Loads a bounded tail of successful history for the next model call. */
    default List<AgentScopeMessage> findTop100ByConversationIdAndStatusOrderByIdDesc(Long conversationId, String status)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("conversation_id").eq(conversationId))
                .and(new QueryColumn("status").eq(status)).orderBy("id desc").limit(100));
    }

    /**
     * Finds a retry by its client idempotency key without allowing a
     * cross-conversation collision.
     */
    default Optional<AgentScopeMessage> findByConversationIdAndTurnTokenAndRole(Long conversationId, String turnToken,
            String role)
    {
        return Optional.ofNullable(
                selectOneByQuery(QueryWrapper.create().where(new QueryColumn("conversation_id").eq(conversationId))
                        .and(new QueryColumn("turn_token").eq(turnToken)).and(new QueryColumn("role").eq(role))));
    }
}
