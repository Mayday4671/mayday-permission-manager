package com.mayday.content;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 单例首页编排只保存受管内容编号，读取时重新核对公开状态，不把选中的草稿直接展示。 */
@Getter
@Setter
@Table(value = "cms_portal_home", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class PortalHome extends BaseEntity
{
    private Long heroArticleId;
    private Long noticeArticleId;

    private String featuredArticleIds = "[]";

    private boolean allowThemeToggle = true;

    private String nightPrimaryColor = "#53d5be";
}
