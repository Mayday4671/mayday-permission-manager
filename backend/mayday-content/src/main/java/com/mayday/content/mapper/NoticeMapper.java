package com.mayday.content.mapper;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.content.Notice;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import org.apache.ibatis.annotations.Mapper;

/**
 * 内容查询由应用层组合权限条件；状态变化共用主记录行锁，防止发布、排期、删除并发覆盖。
 *
 * <p>
 * 标签快照存于 cms_notice_tag：按主键读取时装配，保存主表后必须调用 {@link #syncTags} 在同一事务重建。
 */
@Mapper
public interface NoticeMapper extends EntityMapper<Notice>
{
    /** 门户可见性条件：有效上线、PUBLIC 修订、分类与栏目均启用且未到下线时间； 后台与公开入口复用同一时间语义。 */
    static com.mybatisflex.core.query.QueryCondition publiclyVisible()
    {
        return new QueryColumn("deleted_at").isNull().and(new QueryColumn("published").eq(true))
                .and(new QueryColumn("live_revision_id").isNotNull())
                .and(new com.mybatisflex.core.query.RawQueryCondition(
                        "exists (select 1 from cms_revision lr" + " join sys_entry ce on ce.id = lr.category_id"
                                + " join cms_portal_channel pc on pc.id = lr.portal_channel_id"
                                + " where lr.id = cms_notice.live_revision_id"
                                + " and lr.visibility = 'PUBLIC' and ce.enabled = 1 and pc.enabled = 1)"))
                .and(new QueryColumn("live_offline_at").isNull()
                        .or(new QueryColumn("live_offline_at").gt(com.mayday.common.util.BusinessTime.now())));
    }

    /** 公开列表按上线修订标题搜索；管理列表按草稿标题搜索，不能借搜索探测未发布标题。 */
    static com.mybatisflex.core.query.QueryCondition liveTitleContains(String keyword)
    {
        return new com.mybatisflex.core.query.RawQueryCondition(
                "exists (select 1 from cms_revision s where s.id = cms_notice.live_revision_id"
                        + " and lower(s.title) like ? escape '!')",
                "%" + com.mayday.common.persistence.SearchPredicates.escapedLiteral(keyword) + "%");
    }

    /** 按修订指针（线上/草稿）过滤分类、栏目或模板；参数由调用方校验后传入。 */
    static com.mybatisflex.core.query.QueryCondition revisionPointerFilter(boolean visibleOnly, Long categoryId,
            Long portalChannelId, String portalTemplate)
    {
        String pointer = visibleOnly ? "live_revision_id" : "draft_revision_id";
        StringBuilder sql = new StringBuilder("exists (select 1 from cms_revision s"
                + " join cms_portal_channel pc on pc.id = s.portal_channel_id" + " where s.id = cms_notice." + pointer);
        java.util.List<Object> params = new java.util.ArrayList<>();
        if (categoryId != null)
        {
            sql.append(" and s.category_id = ?");
            params.add(categoryId);
        }
        if (portalChannelId != null)
        {
            sql.append(" and s.portal_channel_id = ?");
            params.add(portalChannelId);
        }
        if (portalTemplate != null)
        {
            sql.append(" and pc.template = ?");
            params.add(portalTemplate);
        }
        sql.append(")");
        return new com.mybatisflex.core.query.RawQueryCondition(sql.toString(), params.toArray());
    }

    /** 生成公开文章查询的固定联表与过滤条件；所有请求参数均由占位符绑定。 */
    private static PublicArticleFilter publicArticleFilter(String keyword, String category, Long categoryId,
            Long portalChannelId, Long tagId, Boolean recommended, String template)
    {
        StringBuilder sql = new StringBuilder("from cms_notice n join cms_revision lr on lr.id = n.live_revision_id"
                + " join sys_entry ce on ce.id = lr.category_id"
                + " join cms_portal_channel pc on pc.id = lr.portal_channel_id"
                + " where n.deleted_at is null and n.published = 1 and lr.visibility = 'PUBLIC'"
                + " and ce.enabled = 1 and pc.enabled = 1"
                + " and (n.live_offline_at is null or n.live_offline_at > ?)");
        List<Object> parameters = new ArrayList<>();
        parameters.add(com.mayday.common.util.BusinessTime.now());
        if (keyword != null && !keyword.isBlank())
        {
            sql.append(" and lower(lr.title) like ? escape '!'");
            parameters.add("%" + com.mayday.common.persistence.SearchPredicates.escapedLiteral(keyword) + "%");
        }
        if (category != null && !category.isBlank())
        {
            sql.append(" and ce.name = ?");
            parameters.add(category);
        }
        if (categoryId != null)
        {
            sql.append(" and lr.category_id = ?");
            parameters.add(categoryId);
        }
        if (portalChannelId != null)
        {
            sql.append(" and lr.portal_channel_id = ?");
            parameters.add(portalChannelId);
        }
        if (tagId != null)
        {
            sql.append(" and exists (select 1 from cms_revision_tag rt"
                    + " where rt.revision_id = lr.id and rt.tag_id = ?)");
            parameters.add(tagId);
        }
        if (recommended != null)
        {
            sql.append(" and lr.recommended = ?");
            parameters.add(recommended);
        }
        if (template != null)
        {
            sql.append(" and pc.template = ?");
            parameters.add(template);
        }
        return new PublicArticleFilter(sql.toString(), parameters);
    }

    /** 公开结果总数由同一组状态、分类和栏目条件计算，供前台分页显示。 */
    default long countPublicArticles(String keyword, String category, Long categoryId, Long portalChannelId, Long tagId,
            Boolean recommended)
    {
        PublicArticleFilter filter = publicArticleFilter(keyword, category, categoryId, portalChannelId, tagId,
                recommended, null);
        Object count = Db.selectObject("select count(*) " + filter.fromWhere(), filter.parameters().toArray());
        return ((Number) count).longValue();
    }

    /** 按上线修订推荐、置顶和栏目顺序在 SQL 层分页；只选主键以避开实体联表投影别名限制。 */
    default List<Long> publicArticleIds(String keyword, String category, Long categoryId, Long portalChannelId,
            Long tagId, Boolean recommended, String template, boolean recommendedFirst, int limit, long offset)
    {
        PublicArticleFilter filter = publicArticleFilter(keyword, category, categoryId, portalChannelId, tagId,
                recommended, template);
        String ordering = recommendedFirst ? "lr.recommended desc, " : "";
        String sql = "select n.id " + filter.fromWhere() + " order by " + ordering
                + "lr.pinned desc, lr.sort_order desc, n.published_at desc, n.id desc limit ? offset ?";
        List<Object> parameters = new ArrayList<>(filter.parameters());
        parameters.add(limit);
        parameters.add(offset);
        return Db.selectListBySql(sql, parameters.toArray()).stream().map(row -> row.getLong("id")).toList();
    }

    /** 公开文章筛选 SQL 及其参数都在同一不可变值中传递，避免值和查询条件错位。 */
    record PublicArticleFilter(String fromWhere, List<Object> parameters) {
    }

    default long countByPublished(boolean published)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("published").eq(published)));
    }

    default boolean existsByDepartmentId(Long departmentId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("department_id").eq(departmentId))) > 0;
    }

    /** 发布、回收及定时排期共用行锁，使状态指针在同一事务内完成切换。 */
    default Optional<Notice> lockById(Long id)
    {
        Notice notice = selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate());
        return notice == null ? Optional.empty() : Optional.of(load(notice));
    }

    /** 在数据库中原子累加，避免多个门户访问用“先读后写”丢失浏览次数。 */
    default void incrementViews(Long id)
    {
        Db.updateBySql("update cms_notice set view_count = view_count + 1 where id = ?", id);
    }

    /** 按主键载入并装配标签快照，保持与旧立即加载一致的视图数据。 */
    @Override
    default Optional<Notice> findById(Serializable id)
    {
        Notice notice = selectOneById(id);
        return notice == null ? Optional.empty() : Optional.of(load(notice));
    }

    /** 按主键集合载入并装配标签快照。 */
    @Override
    default List<Notice> findAllById(Iterable<Long> ids)
    {
        List<Notice> notices = EntityMapper.super.findAllById(ids);
        notices.forEach(this::load);
        return notices;
    }

    /** 装配标签文本快照；空集合代表尚未设置标签，调用方不得用它推断修订标签。 */
    default Notice load(Notice notice)
    {
        Set<String> tags = new HashSet<>();
        for (var row : Db.selectListBySql("select tag from cms_notice_tag where notice_id = ?", notice.getId()))
        {
            tags.add(row.getString("tag"));
        }
        notice.setTags(tags);
        return notice;
    }

    /** 保存主表后在同一事务全量重建标签快照；调用方必须已完成主表保存。 */
    default void syncTags(Notice notice)
    {
        Db.deleteBySql("delete from cms_notice_tag where notice_id = ?", notice.getId());
        for (String tag : notice.getTags())
        {
            Db.updateBySql("insert into cms_notice_tag(notice_id, tag) values (?, ?)", notice.getId(), tag);
        }
    }

    /** 彻底清除内容前删除旧版文本标签快照；回收与恢复仍保留此关联，供原兼容接口读取。 */
    default void deleteTagsByNoticeId(Long noticeId)
    {
        Db.deleteBySql("delete from cms_notice_tag where notice_id = ?", noticeId);
    }

    /** 标签文本快照被引用的数量；标签删除保护由资料中心调用。 */
    default long countByTag(String tag)
    {
        return com.mybatisflex.core.row.Db.selectCountByQuery("cms_notice_tag",
                QueryWrapper.create().where(new QueryColumn("tag").eq(tag)));
    }
}
