package com.mayday.agentscope;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

/**
 * AgentScope REST contract. Requests contain only user text and an idempotency UUID; identity,
 * model and session are server-owned.
 */
public final class AgentScopeDtos {
  private AgentScopeDtos() {}

  /** Safe deployment status that deliberately omits credentials and internal provider settings. */
  public record StatusView(
      boolean enabled,
      boolean modelReady,
      String version,
      int requestTimeoutSeconds,
      int maxMessageLength,
      int contextMessageCount) {}

  /** A conversation visible only to its authenticated owner. */
  public record ConversationView(
      Long id,
      String title,
      LocalDateTime createdAt,
      LocalDateTime updatedAt,
      LocalDateTime lastMessageAt) {}

  /** A plain-text message. Content is never treated as HTML by the frontend. */
  public record MessageView(
      Long id, String role, String content, String status, LocalDateTime createdAt) {}

  /** One completed user/assistant turn returned by a synchronous send operation. */
  public record TurnView(MessageView user, MessageView assistant) {}

  /** User input is length-bounded and paired with a client-generated UUID for safe retries. */
  public record SendMessageRequest(
      @NotBlank @Size(max = 4000) String content,
      @NotBlank @Pattern(regexp = "^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
          String requestId) {}
}
