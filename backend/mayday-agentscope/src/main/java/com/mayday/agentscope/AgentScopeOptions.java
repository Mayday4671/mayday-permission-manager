package com.mayday.agentscope;

/**
 * One atomically replaceable snapshot of the effective AgentScope settings.
 *
 * <p>
 * The API key is an internal runtime value. Controllers return a separate safe
 * view DTO and must never serialize this record.
 */
public record AgentScopeOptions(String apiKey, String model, int requestTimeoutSeconds, int maxMessageLength,
        int maxContextMessages, String systemPrompt) {

    /**
     * Reports whether a model call can be attempted without exposing provider
     * credentials.
     */
    public boolean modelReady()
    {
        return apiKey != null && !apiKey.isBlank() && model != null && model.startsWith("dashscope:");
    }

    /** Keeps recent context in complete user/assistant pairs. */
    public int effectiveContextMessageCount()
    {
        return Math.max(2, maxContextMessages - maxContextMessages % 2);
    }
}
