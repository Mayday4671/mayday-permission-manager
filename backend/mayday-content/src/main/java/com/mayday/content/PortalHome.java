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

    /** 首页主视觉文章逻辑 ID；为空自动选已公开指南，下线时隐藏，绝不自动发布文章 */
    private Long heroArticleId;

    /** 首页公告条文章逻辑 ID；只可选择公开公告栏目内容，为空自动选最近公告 */
    private Long noticeArticleId;

    /** 有序精选文章 ID 数组 JSON，最多 12 篇；空数组自动选择最近公开内容，访问时逐篇校验 */
    private String featuredArticleIds = "[]";

    /** 是否允许访客在本浏览器切换明暗；0 时严格使用网站配置主题，访客不能回写全站 */
    private boolean allowThemeToggle = true;

    /** 门户暗夜强调色，格式 #RRGGBB；默认薄荷色，后台管理主题与此独立 */
    private String nightPrimaryColor = "#53d5be";
}
