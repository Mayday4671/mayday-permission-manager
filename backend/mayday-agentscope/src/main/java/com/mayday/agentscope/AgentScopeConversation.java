package com.mayday.agentscope;

import com.mayday.common.BaseEntity;
import com.mybatisflex.annotation.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * 私有智能体会话目录。ownerId 总是由认证主体赋值；sessionId 为随机 UUID，并与数据库 ownerId 共同构成 AgentScope 状态分区键。列表、读取、删除均按
 * ownerId 查询，不接受前端传入所有者。
 */
@Getter
@Setter
@Table(
    value = "ai_agent_conversation",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class AgentScopeConversation extends BaseEntity {
  /** 会话所有者；来自当前用户，不因角色数据范围设置而共享给其他账号。 */
  private Long ownerId;

  /** AgentScope RuntimeContext 使用的不可预测会话 ID；不会把数据库自增主键暴露给模型状态层。 */
  private String sessionId;

  /** 首条用户消息的安全截断标题；不接收客户端单独提交的标题。 */
  private String title;

  /** 当前正在处理的请求租约；同一会话在不同应用实例之间也只能有一个活动请求。 */
  private String processingToken;

  /** 当前租约对应的客户端幂等令牌；用于实例崩溃后将未完成用户消息标记为可重试。 */
  private String processingRequestId;

  /** 租约开始时间；应用异常退出后，超过服务端超时的请求可由后续请求安全接管。 */
  private LocalDateTime processingStartedAt;

  /** 最近一轮成功问答时间；没有任何消息的会话为空。 */
  private LocalDateTime lastMessageAt;
}
