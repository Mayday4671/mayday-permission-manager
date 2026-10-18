package com.mayday.agentscope;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/** 用于界面分页和恢复上下文的持久消息。角色、状态与 turnToken 均由后端设定；消息正文作为纯文本 展示，不能被前端解释为 HTML 或执行代码。 */
@Entity
@Table(
    name = "ai_agent_message",
    indexes = {
      @Index(name = "idx_ai_agent_message_conversation", columnList = "conversation_id,id")
    },
    uniqueConstraints = {
      @UniqueConstraint(
          name = "uq_ai_agent_message_turn_role",
          columnNames = {"conversation_id", "turn_token", "role"})
    })
@Getter
@Setter
public class AgentScopeMessage extends BaseEntity {
  /** 父会话 ID；外键与会话删除级联由 Flyway 迁移维护。 */
  @Column(nullable = false, updatable = false, name = "conversation_id")
  private Long conversationId;

  /** 固定角色 USER 或 ASSISTANT；禁止从请求正文选择任意角色。 */
  @Column(nullable = false, length = 16)
  private String role;

  /** 纯文本正文；用户输入长度由请求校验限制，助手回复保留原始纯文本内容。 */
  @Column(nullable = false, columnDefinition = "LONGTEXT")
  private String content;

  /** 用户消息可为 PROCESSING、COMPLETE 或 FAILED；助手消息只在调用完成后保存为 COMPLETE。 */
  @Column(nullable = false, length = 16)
  private String status;

  /** 一次提交的幂等令牌；同一会话内每轮按角色唯一，防止网络重试重复写入。 */
  @Column(nullable = false, updatable = false, length = 36, name = "turn_token")
  private String turnToken;
}
