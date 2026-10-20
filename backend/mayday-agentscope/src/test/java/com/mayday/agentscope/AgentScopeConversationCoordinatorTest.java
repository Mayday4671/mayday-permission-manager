package com.mayday.agentscope;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.agentscope.mapper.AgentScopeConversationMapper;
import com.mayday.agentscope.mapper.AgentScopeMessageMapper;
import com.mayday.common.exception.ConflictException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** Verifies the database lease and idempotency boundaries without calling a model provider. */
@ExtendWith(MockitoExtension.class)
class AgentScopeConversationCoordinatorTest {
  private static final Long OWNER_ID = 41L;
  private static final Long CONVERSATION_ID = 73L;
  private static final String REQUEST_ID = "43ce66a9-75b9-4cad-bf1b-aa189b22071e";
  private static final String PROMPT = "请总结这条记录";

  @Mock private AgentScopeConversationMapper conversations;
  @Mock private AgentScopeMessageMapper messages;
  @Mock private AgentScopeSettings settings;

  @InjectMocks private AgentScopeConversationCoordinator coordinator;

  /** Creates a minimum persisted conversation with the request lease owned by another call. */
  private static AgentScopeConversation conversation(String requestId, String leaseToken) {
    AgentScopeConversation conversation = new AgentScopeConversation();
    conversation.setId(CONVERSATION_ID);
    conversation.setOwnerId(OWNER_ID);
    conversation.setSessionId(UUID.randomUUID().toString());
    conversation.setTitle("已有会话");
    conversation.setProcessingRequestId(requestId);
    conversation.setProcessingToken(leaseToken);
    return conversation;
  }

  /** Creates a user turn used to exercise idempotent retry handling. */
  private static AgentScopeMessage userMessage(String requestId, String content, String status) {
    AgentScopeMessage message = new AgentScopeMessage();
    message.setId(1L);
    message.setConversationId(CONVERSATION_ID);
    message.setTurnToken(requestId);
    message.setRole("USER");
    message.setContent(content);
    message.setStatus(status);
    return message;
  }

  /** An expired retry receives a fresh lease token distinct from its idempotency key. */
  @Test
  void expiredRetryUsesFreshFencingToken() {
    AgentScopeConversation conversation = conversation(REQUEST_ID, "expired-lease");
    AgentScopeMessage pending = userMessage(REQUEST_ID, PROMPT, "PROCESSING");
    when(conversations.findByIdAndOwnerId(CONVERSATION_ID, OWNER_ID))
        .thenReturn(Optional.of(conversation), Optional.of(conversation));
    when(messages.findByConversationIdAndTurnTokenAndRole(CONVERSATION_ID, REQUEST_ID, "USER"))
        .thenReturn(Optional.of(pending));
    when(conversations.claimProcessing(
            eq(CONVERSATION_ID), eq(OWNER_ID), anyString(), eq(REQUEST_ID), any(), any()))
        .thenReturn(1);
    when(messages.save(any(AgentScopeMessage.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));
    when(messages.findTop100ByConversationIdAndStatusOrderByIdDesc(CONVERSATION_ID, "COMPLETE"))
        .thenReturn(List.of());
    when(settings.getRequestTimeoutSeconds()).thenReturn(120);
    when(settings.effectiveContextMessageCount()).thenReturn(40);

    AgentScopeConversationCoordinator.TurnStart turn =
        coordinator.beginTurn(OWNER_ID, CONVERSATION_ID, REQUEST_ID, PROMPT);

    assertThat(turn.leaseToken()).isNotBlank().isNotEqualTo(REQUEST_ID);
    assertThat(turn.completed()).isNull();
    assertThat(pending.getStatus()).isEqualTo("PROCESSING");
    verify(conversations)
        .claimProcessing(
            eq(CONVERSATION_ID), eq(OWNER_ID), eq(turn.leaseToken()), eq(REQUEST_ID), any(), any());
  }

  /** A model result from an expired invocation cannot complete a newer invocation's turn. */
  @Test
  void staleInvocationCannotCompleteTurn() {
    AgentScopeConversation conversation = conversation(REQUEST_ID, UUID.randomUUID().toString());
    when(conversations.findByIdAndOwnerId(CONVERSATION_ID, OWNER_ID))
        .thenReturn(Optional.of(conversation));

    assertThatThrownBy(
            () ->
                coordinator.completeTurn(
                    OWNER_ID, CONVERSATION_ID, REQUEST_ID, "old-lease", "迟到的回复"))
        .isInstanceOf(ConflictException.class);

    verify(messages, never())
        .findByConversationIdAndTurnTokenAndRole(any(), anyString(), anyString());
  }

  /** A stale model failure must not mark a newer retry as failed or release its active lease. */
  @Test
  void staleInvocationCannotFailOrReleaseNewerTurn() {
    AgentScopeConversation conversation = conversation(REQUEST_ID, UUID.randomUUID().toString());
    when(conversations.findByIdAndOwnerId(CONVERSATION_ID, OWNER_ID))
        .thenReturn(Optional.of(conversation));

    coordinator.failTurn(OWNER_ID, CONVERSATION_ID, REQUEST_ID, "old-lease");

    verify(messages, never())
        .findByConversationIdAndTurnTokenAndRole(any(), anyString(), anyString());
    verify(conversations, never()).releaseProcessing(any(), any(), anyString());
  }
}
