package com.mayday.agentscope;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * AgentScope 服务端配置。凭据只从容器/进程环境变量注入，不进入数据库、前端、操作日志或接口响应； 调整配置后重启应用，模型提供方扩展需与对应的
 * AgentScope 官方 model extension 一同部署。
 */
@Getter
@Setter
@Validated
@ConfigurationProperties(prefix = "mayday.agentscope")
public class AgentScopeSettings
{
    /** DashScope 凭据；仅用于判断是否已配置，绝不序列化或输出到日志。 */
    private String apiKey = "";

    /** AgentScope ModelRegistry 使用的模型标识；客户端不能自行选择模型或供应商。 */
    private String model = "dashscope:qwen-plus";

    /** AgentScope SDK 版本；用于后台状态展示和运维排查。 */
    private String version = "2.0.4";

    /** 单次模型调用的最长等待时间，超过后请求取消并释放会话占用。 */
    @Min(10)
    @Max(300)
    private int requestTimeoutSeconds = 120;

    /** 用户消息长度上限，和 REST DTO 限制保持一致，避免意外传入超大上下文。 */
    @Min(1)
    @Max(4000)
    private int maxMessageLength = 4000;

    /** 每次模型调用从 MySQL 对话记录中恢复的最近消息数，实际值向下取偶数以保留完整轮次。 */
    @Min(2)
    @Max(100)
    private int maxContextMessages = 40;

    /** 由管理员通过部署配置调整的系统提示词，不接受用户请求覆盖。 */
    private String systemPrompt = "你是 Mayday 工作空间中的通用助手。请以中文清晰、准确地回答问题；你无法访问平台业务数据或执行外部操作，遇到超出上下文的信息时应如实说明。";

    /** 仅公开是否具备模型调用条件，不公开密钥。当前独立模块仅打包 DashScope provider，其他模型须另加官方扩展。 */
    public boolean isModelReady()
    {
        return apiKey != null && !apiKey.isBlank() && model.startsWith("dashscope:");
    }

    /** 提示词上下文保留完整的问答轮次，且至少保留一轮。 */
    public int effectiveContextMessageCount()
    {
        return Math.max(2, maxContextMessages - maxContextMessages % 2);
    }
}
