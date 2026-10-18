package com.mayday.agentscope;

import com.mayday.common.BusinessException;
import com.mayday.common.ModuleSwitches;
import com.mayday.security.AccessPolicy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Owns safe administrator configuration and the atomically replaceable runtime settings.
 *
 * <p>Environment properties remain deployment defaults. Saved administrator values take precedence
 * until explicitly cleared; the encrypted API key is never returned to a caller.
 */
@Service
@DependsOnDatabaseInitialization
public class AgentScopeConfigurationService implements InitializingBean {
  private static final String SELECT_SQL =
      "select api_key_cipher, model, request_timeout_seconds, max_message_length, "
          + "max_context_messages, system_prompt from sys_agentscope_config where id = 1";
  private static final RowMapper<StoredSettings> ROW_MAPPER =
      AgentScopeConfigurationService::mapRow;

  private final JdbcTemplate jdbc;
  private final AgentScopeSettings deploymentDefaults;
  private final AgentScopeSecretCipher cipher;
  private final ModuleSwitches modules;
  private final AccessPolicy access;
  private final TransactionTemplate transaction;
  private final AtomicReference<AgentScopeOptions> current = new AtomicReference<>();

  /** Builds a transaction boundary so runtime state is published only after the database commit. */
  public AgentScopeConfigurationService(
      JdbcTemplate jdbc,
      AgentScopeSettings deploymentDefaults,
      AgentScopeSecretCipher cipher,
      ModuleSwitches modules,
      AccessPolicy access,
      PlatformTransactionManager transactionManager) {
    this.jdbc = jdbc;
    this.deploymentDefaults = deploymentDefaults;
    this.cipher = cipher;
    this.modules = modules;
    this.access = access;
    this.transaction = new TransactionTemplate(transactionManager);
  }

  /**
   * Loads persisted values after Flyway and uses deployment properties for an empty configuration.
   */
  @Override
  public void afterPropertiesSet() {
    List<StoredSettings> rows = jdbc.query(SELECT_SQL, ROW_MAPPER);
    if (rows.isEmpty()) {
      current.set(fromDeploymentDefaults());
      return;
    }
    StoredSettings stored = rows.getFirst();
    current.set(toOptions(stored, stored.apiKeyCipher()));
  }

  /**
   * Returns editable non-secret values and booleans only; provider credentials never leave the
   * server.
   */
  public SettingsView getSettings() {
    access.require("agentscope:configure");
    return view(current.get(), source());
  }

  /** Validates and persists administrator changes before atomically replacing runtime settings. */
  public synchronized SettingsView saveSettings(SettingsRequest request) {
    access.require("agentscope:configure");
    validate(request);

    StoredSettings previous = jdbc.query(SELECT_SQL, ROW_MAPPER).stream().findFirst().orElse(null);
    String apiKeyCipher = previous == null ? null : previous.apiKeyCipher();
    String submittedSecret = request.apiSecret() == null ? "" : request.apiSecret().trim();
    if (request.clearApiSecret() && !submittedSecret.isEmpty())
      throw new BusinessException("不能同时填写新密钥并选择清除密钥");
    if (request.clearApiSecret()) apiKeyCipher = null;
    else if (!submittedSecret.isEmpty()) apiKeyCipher = cipher.encrypt(submittedSecret);

    StoredSettings next =
        new StoredSettings(
            apiKeyCipher,
            request.model().trim(),
            request.requestTimeoutSeconds(),
            request.maxMessageLength(),
            request.maxContextMessages(),
            request.systemPrompt().trim());
    Long actorId = access.current().getId();
    transaction.executeWithoutResult(
        status ->
            jdbc.update(
                "insert into sys_agentscope_config "
                    + "(id, api_key_cipher, model, request_timeout_seconds, max_message_length, "
                    + "max_context_messages, system_prompt, updated_by, created_at, updated_at) "
                    + "values (1, ?, ?, ?, ?, ?, ?, ?, now(6), now(6)) "
                    + "on duplicate key update api_key_cipher = values(api_key_cipher), "
                    + "model = values(model), request_timeout_seconds = values(request_timeout_seconds), "
                    + "max_message_length = values(max_message_length), "
                    + "max_context_messages = values(max_context_messages), "
                    + "system_prompt = values(system_prompt), updated_by = values(updated_by), "
                    + "updated_at = now(6)",
                next.apiKeyCipher(),
                next.model(),
                next.requestTimeoutSeconds(),
                next.maxMessageLength(),
                next.maxContextMessages(),
                next.systemPrompt(),
                actorId));
    current.set(toOptions(next, next.apiKeyCipher()));
    return view(current.get(), "后台配置");
  }

  /** Supplies one consistent snapshot to chat and status code paths. */
  public AgentScopeOptions current() {
    return current.get();
  }

  private AgentScopeOptions fromDeploymentDefaults() {
    return new AgentScopeOptions(
        deploymentDefaults.getApiKey(),
        deploymentDefaults.getModel(),
        deploymentDefaults.getRequestTimeoutSeconds(),
        deploymentDefaults.getMaxMessageLength(),
        deploymentDefaults.getMaxContextMessages(),
        deploymentDefaults.getSystemPrompt());
  }

  private AgentScopeOptions toOptions(StoredSettings stored, String apiKeyCipher) {
    String apiKey =
        apiKeyCipher == null || apiKeyCipher.isBlank()
            ? deploymentDefaults.getApiKey()
            : cipher.decrypt(apiKeyCipher);
    return new AgentScopeOptions(
        apiKey,
        stored.model(),
        stored.requestTimeoutSeconds(),
        stored.maxMessageLength(),
        stored.maxContextMessages(),
        stored.systemPrompt());
  }

  private SettingsView view(AgentScopeOptions options, String configurationSource) {
    return new SettingsView(
        modules.isEnabled("agentscope"),
        options.modelReady(),
        options.apiKey() != null && !options.apiKey().isBlank(),
        hasStoredApiKey(),
        deploymentDefaults.getVersion(),
        options.model(),
        options.requestTimeoutSeconds(),
        options.maxMessageLength(),
        options.effectiveContextMessageCount(),
        options.systemPrompt(),
        configurationSource);
  }

  private String source() {
    return jdbc.query(SELECT_SQL, ROW_MAPPER).isEmpty() ? "部署默认值" : "后台配置";
  }

  /** Indicates whether an encrypted administrator override exists, without reading its contents. */
  private boolean hasStoredApiKey() {
    return jdbc.query(SELECT_SQL, ROW_MAPPER).stream()
        .findFirst()
        .map(row -> row.apiKeyCipher() != null && !row.apiKeyCipher().isBlank())
        .orElse(false);
  }

  private static void validate(SettingsRequest request) {
    String model = request.model() == null ? "" : request.model().trim();
    if (!model.matches("^dashscope:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$"))
      throw new BusinessException("模型 ID 格式不正确；百炼模型示例：dashscope:qwen3.7-plus");
    String secret = request.apiSecret() == null ? "" : request.apiSecret().trim();
    if (secret.length() > 512 || secret.chars().anyMatch(Character::isISOControl))
      throw new BusinessException("百炼 API Key 格式不正确");
    if (request.systemPrompt() == null || request.systemPrompt().isBlank())
      throw new BusinessException("系统提示词不能为空");
  }

  private static StoredSettings mapRow(ResultSet row, int rowNumber) throws SQLException {
    return new StoredSettings(
        row.getString("api_key_cipher"),
        row.getString("model"),
        row.getInt("request_timeout_seconds"),
        row.getInt("max_message_length"),
        row.getInt("max_context_messages"),
        row.getString("system_prompt"));
  }

  private record StoredSettings(
      String apiKeyCipher,
      String model,
      int requestTimeoutSeconds,
      int maxMessageLength,
      int maxContextMessages,
      String systemPrompt) {}

  /** Safe read model; it exposes secret presence, never any part of the provider key. */
  public record SettingsView(
      boolean moduleEnabled,
      boolean modelReady,
      boolean apiSecretConfigured,
      boolean apiSecretOverrideStored,
      String sdkVersion,
      String model,
      int requestTimeoutSeconds,
      int maxMessageLength,
      int maxContextMessages,
      String systemPrompt,
      String configurationSource) {}

  /** Write model; the submitted API secret is accepted once and is never read back. */
  public record SettingsRequest(
      String model,
      int requestTimeoutSeconds,
      int maxMessageLength,
      int maxContextMessages,
      String systemPrompt,
      String apiSecret,
      boolean clearApiSecret) {}
}
