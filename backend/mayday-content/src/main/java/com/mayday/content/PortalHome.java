package com.mayday.content;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 单例首页编排只保存受管内容编号，读取时重新核对公开状态，不把选中的草稿直接展示。 */
@Getter
@Setter
@Entity
@Table(name = "cms_portal_home")
public class PortalHome extends BaseEntity {
  private Long heroArticleId;
  private Long noticeArticleId;

  @Column(nullable = false, length = 600)
  private String featuredArticleIds = "[]";

  private boolean allowThemeToggle = true;

  @Column(nullable = false, length = 7)
  private String nightPrimaryColor = "#53d5be";
}
