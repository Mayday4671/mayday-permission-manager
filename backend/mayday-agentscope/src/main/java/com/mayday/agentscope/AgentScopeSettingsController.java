package com.mayday.agentscope;

import com.mayday.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Administrator-only configuration endpoint, separate from general system parameters. */
@RestController
@RequestMapping("/api/system/agentscope/configuration")
@RequiredArgsConstructor
@Validated
public class AgentScopeSettingsController {
  private final AgentScopeConfigurationService configuration;

  /** Returns safe settings metadata and never returns the configured secret. */
  @GetMapping
  @PreAuthorize("@access.has('agentscope:configure')")
  public ApiResponse<AgentScopeConfigurationService.SettingsView> getSettings() {
    return ApiResponse.ok(configuration.getSettings());
  }

  /** Saves administrator-chosen model limits and an optional replacement secret. */
  @PutMapping
  @PreAuthorize("@access.has('agentscope:configure')")
  public ApiResponse<AgentScopeConfigurationService.SettingsView> saveSettings(
      @Valid @RequestBody SettingsRequest request) {
    return ApiResponse.ok(
        configuration.saveSettings(
            new AgentScopeConfigurationService.SettingsRequest(
                request.model(),
                request.requestTimeoutSeconds(),
                request.maxMessageLength(),
                request.maxContextMessages(),
                request.systemPrompt(),
                request.apiSecret(),
                request.clearApiSecret())));
  }

  /** HTTP contract limits mirror the service's strict accepted ranges. */
  public record SettingsRequest(
      @NotBlank @Pattern(regexp = "^dashscope:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$") String model,
      @Min(10) @Max(300) int requestTimeoutSeconds,
      @Min(1) @Max(4000) int maxMessageLength,
      @Min(2) @Max(100) int maxContextMessages,
      @NotBlank @Size(max = 4000) String systemPrompt,
      @Size(max = 512) String apiSecret,
      boolean clearApiSecret) {}
}
