package com.mayday.agentscope;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 用于界面分页和恢复上下文的持久消息。角色、状态与 turnToken 均由后端设定；消息正文作为纯文本 展示，不能被前端解释为 HTML 或执行代码。
 */
@Getter
@Setter
@Table(value = "ai_agent_message", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class AgentScopeMessage extends BaseEntity
{
    /** 父会话 ID；外键与会话删除级联由 Flyway 迁移维护。 */
    private Long conversationId;

    /** 固定角色 USER 或 ASSISTANT；禁止从请求正文选择任意角色。 */
    private String role;

    /** 纯文本正文；用户输入长度由请求校验限制，助手回复保留原始纯文本内容。 */
    private String content;

    /** 用户消息可为 PROCESSING、COMPLETE 或 FAILED；助手消息只在调用完成后保存为 COMPLETE。 */
    private String status;

    /** 一次提交的幂等令牌；同一会话内每轮按角色唯一，防止网络重试重复写入。 */
    private String turnToken;
}
