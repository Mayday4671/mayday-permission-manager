package com.mayday.content;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 门户栏目是独立导航和页面模板，不能由分类名称推断；稳定访问名称保护已有书签。 */
@Getter
@Setter
@Table(value = "cms_portal_channel", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class PortalChannel extends BaseEntity
{
    private String code;

    private String name;

    private String template;

    private String description;

    private int sortOrder;
    private boolean enabled = true;
}
