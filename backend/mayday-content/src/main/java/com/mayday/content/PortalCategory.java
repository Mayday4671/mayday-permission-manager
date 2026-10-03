package com.mayday.content;

import com.mayday.system.model.SystemEntry;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 分类只属于一个门户栏目；分类本身继续复用资料中心的名称、启停与版本约束。 */
@Getter
@Setter
@Entity
@Table(name = "cms_portal_category")
public class PortalCategory {
  @Id
  @Column(name = "category_id")
  private Long categoryId;

  @Column(name = "channel_id", nullable = false)
  private Long channelId;

  private int sortOrder;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "category_id", insertable = false, updatable = false)
  private SystemEntry category;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "channel_id", insertable = false, updatable = false)
  private PortalChannel channel;
}
