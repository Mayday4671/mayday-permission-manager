package com.mayday.operations.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/** 临时审批委托只追加或撤销；不改写已办理历史，不把接收委托当作角色授权。 */
@Getter
@Setter
@Entity
@Table(name = "ops_flow_delegation")
public class FlowDelegation extends BaseEntity {
  @Column(nullable = false)
  private Long ownerId;

  @Column(nullable = false, length = 64)
  private String ownerName;

  @Column(nullable = false)
  private Long targetId;

  @Column(nullable = false, length = 64)
  private String targetName;

  @Column(nullable = false)
  private LocalDateTime startsAt;

  @Column(nullable = false)
  private LocalDateTime endsAt;

  /** 空数组表示全部审批流程；非空数组只包含发布定义编号，不绑定设计草稿。 */
  @Column(nullable = false, columnDefinition = "text")
  private String definitionIdsJson;

  @Column(nullable = false, length = 500)
  private String reason;

  /** 撤销仅阻止后续任务委托；已经激活的任务需显式转交或管理员交接。 */
  private LocalDateTime revokedAt;
}
