package com.mayday.content;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/** 门户栏目是独立导航和页面模板，不能由分类名称推断；稳定访问名称保护已有书签。 */
@Getter
@Setter
@Entity
@Table(name = "cms_portal_channel")
public class PortalChannel extends BaseEntity {
  @Column(nullable = false, unique = true, length = 48)
  private String code;

  @Column(nullable = false, length = 40)
  private String name;

  @Column(nullable = false, length = 16)
  private String template;

  @Column(length = 500)
  private String description;

  private int sortOrder;
  private boolean enabled = true;
}
