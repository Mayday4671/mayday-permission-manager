package com.mayday.agentscope;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import com.mayday.common.exception.ServiceUnavailableException;
import io.agentscope.core.agent.RuntimeContext;
import io.agentscope.core.message.AssistantMessage;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.UserMessage;
import io.agentscope.core.state.AgentStateStore;
import io.agentscope.core.tool.Toolkit;
import io.agentscope.extensions.model.dashscope.DashScopeChatModel;
import io.agentscope.harness.agent.HarnessAgent;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Builds isolated AgentScope executions from the canonical Mayday transcript
 * and JDBC state store.
 */
@Component
@RequiredArgsConstructor
public class AgentScopeRuntime
{
    private final AgentScopeConfigurationService configuration;
    private final AgentStateStore stateStore;

    /**
     * Runs one bounded text-only turn. The Mayday message table is authoritative:
     * the SDK context is cleared and reconstructed from successful messages before
     * every call, which recovers cleanly after a failed turn.
     */
    public String reply(Long ownerId, String sessionId, List<AgentScopeMessage> history, String prompt)
    {
        AgentScopeOptions options = configuration.current();
        if (!options.modelReady())
        {
            throw new ServiceUnavailableException("智能体尚未配置模型服务，请联系系统管理员");
        }
        String userId = ownerId.toString();
        RuntimeContext context = RuntimeContext.builder().userId(userId).sessionId(sessionId).build();
        try (HarnessAgent agent = buildAgent(options))
        {
            agent.clearContext(context);
            List<Msg> transcript = toTranscript(history);
            transcript.add(new UserMessage(prompt));
            Msg answer = agent.call(transcript, context).block(Duration.ofSeconds(options.requestTimeoutSeconds()));
            if (answer == null || answer.getTextContent() == null || answer.getTextContent().isBlank())
            {
                throw new ServiceUnavailableException("智能体暂时没有生成可显示的回复，请稍后重试");
            }
            return answer.getTextContent();
        } catch (ServiceUnavailableException exception)
        {
            clearState(userId, sessionId);
            throw exception;
        } catch (RuntimeException exception)
        {
            // Do not log provider exceptions: SDK diagnostics may contain request metadata
            // or
            // credentials.
            clearState(userId, sessionId);
            throw new ServiceUnavailableException("智能体服务暂时不可用，请稍后重试");
        }
    }

    /**
     * Deletes provider-side state after conversation removal or a failed model
     * call.
     */
    public void clearState(Long ownerId, String sessionId)
    {
        clearState(ownerId.toString(), sessionId);
    }

    /**
     * Deletes every AgentScope state partition belonging to a user for secure
     * account erasure.
     */
    public void clearUserState(Long ownerId)
    {
        String userId = ownerId.toString();
        stateStore.listSessionIds(userId).forEach(sessionId -> clearState(userId, sessionId));
    }

    private HarnessAgent buildAgent(AgentScopeOptions options)
    {
        return HarnessAgent.builder().name("mayday-assistant").description("Mayday 内部工作助手")
                .sysPrompt(options.systemPrompt())
                .model(DashScopeChatModel.builder().apiKey(options.apiKey())
                        .modelName(options.model().substring("dashscope:".length())).build())
                .toolkit(new Toolkit()).stateStore(stateStore).maxIters(1).disableFilesystemTools().disableShellTool()
                .disableWebTools().disableMemoryTools().disableMemoryHooks().disableTranscript()
                .disableSessionPersistence().disableWorkspaceContext().disableSubagents().disableDynamicSubagents()
                .disableDynamicSkills().disableDefaultWorkspaceSkills().disableToolsConfig().build();
    }

    private List<Msg> toTranscript(List<AgentScopeMessage> history)
    {
        List<Msg> transcript = new ArrayList<>(history.size());
        for (AgentScopeMessage message : history)
        {
            if ("USER".equals(message.getRole()))
            {
                transcript.add(new UserMessage(message.getContent()));
            } else if ("ASSISTANT".equals(message.getRole()))
            {
                transcript.add(new AssistantMessage(message.getContent()));
            }
        }
        return transcript;
    }

    private void clearState(String userId, String sessionId)
    {
        stateStore.delete(userId, sessionId);
    }
}
