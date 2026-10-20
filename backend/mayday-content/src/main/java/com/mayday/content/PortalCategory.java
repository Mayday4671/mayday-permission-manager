package com.mayday.content;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 分类只属于一个门户栏目；分类本身继续复用资料中心的名称、启停与版本约束。
 *
 * <p>主键即资料中心的分类 ID，不继承业务实体的自增主键与审计列；分类与栏目名称由查询显式联表取得。
 */
@Getter
@Setter
@Table("cms_portal_category")
public class PortalCategory {
  @Id(keyType = KeyType.None)
  private Long categoryId;

  private Long channelId;

  private int sortOrder;
}
