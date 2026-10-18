package com.mayday.agentscope;

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST endpoints for one owner's conversations; permission is checked again in the service
 * boundary.
 */
@RestController
@RequestMapping("/api/agentscope")
@RequiredArgsConstructor
@Validated
public class AgentScopeController {
  private final AgentScopeService service;

  /** Reports readiness without returning provider credentials or model request details. */
  @GetMapping("/status")
  @PreAuthorize("@access.has('agentscope:view')")
  public ApiResponse<AgentScopeDtos.StatusView> status() {
    return ApiResponse.ok(service.status());
  }

  /** Lists only the current user's conversations using a bounded page size. */
  @GetMapping("/conversations")
  @PreAuthorize("@access.has('agentscope:view')")
  public ApiResponse<PageResult<AgentScopeDtos.ConversationView>> conversations(
      @RequestParam(defaultValue = "1") @Min(1) int page,
      @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
    return ApiResponse.ok(service.conversations(page, size));
  }

  /** Creates an empty conversation owned by the authenticated account. */
  @PostMapping("/conversations")
  @PreAuthorize("@access.has('agentscope:create')")
  public ApiResponse<AgentScopeDtos.ConversationView> createConversation() {
    return ApiResponse.ok(service.createConversation());
  }

  /**
   * Loads one bounded message page after resolving the parent within the current owner's boundary.
   */
  @GetMapping("/conversations/{id}/messages")
  @PreAuthorize("@access.has('agentscope:view')")
  public ApiResponse<PageResult<AgentScopeDtos.MessageView>> messages(
      @PathVariable @Min(1) Long id,
      @RequestParam(defaultValue = "1") @Min(1) int page,
      @RequestParam(defaultValue = "50") @Min(1) @Max(100) int size) {
    return ApiResponse.ok(service.messages(id, page, size));
  }

  /**
   * Sends one length-bounded text message; client identity, tools and model selection are not
   * accepted.
   */
  @PostMapping("/conversations/{id}/messages")
  @PreAuthorize("@access.has('agentscope:view') and @access.has('agentscope:chat')")
  public ApiResponse<AgentScopeDtos.TurnView> send(
      @PathVariable @Min(1) Long id,
      @Valid @RequestBody AgentScopeDtos.SendMessageRequest request) {
    return ApiResponse.ok(service.send(id, request));
  }

  /** Removes one owned idle conversation and its stored AgentScope context. */
  @DeleteMapping("/conversations/{id}")
  @PreAuthorize("@access.has('agentscope:delete')")
  public ApiResponse<Void> deleteConversation(@PathVariable @Min(1) Long id) {
    service.deleteConversation(id);
    return ApiResponse.ok(null);
  }
}
