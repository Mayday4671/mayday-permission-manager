package com.mayday.content.mapper;

import com.mayday.common.EntityMapper;
import com.mayday.content.ContentRevision;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.io.Serializable;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.apache.ibatis.annotations.Mapper;

/**
 * 不可变正文修订查询；分类、标签和附件的存在性判断保护所有历史引用，而非仅当前上线版本。
 *
 * <p>标签与附件是关联表：按主键读取时装配，保存修订后必须调用 {@link #syncCollections} 在同一事务重建。
 */
@Mapper
public interface ContentRevisionMapper extends EntityMapper<ContentRevision> {
  default List<ContentRevision> findByNoticeIdOrderByRevisionNumberDesc(Long noticeId) {
    List<ContentRevision> revisions =
        selectListByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("notice_id").eq(noticeId))
                .orderBy("revision_number desc"));
    revisions.forEach(this::load);
    return revisions;
  }

  /** 按主键载入并装配标签与附件集合。 */
  @Override
  default Optional<ContentRevision> findById(Serializable id) {
    ContentRevision revision = selectOneById(id);
    return revision == null ? Optional.empty() : Optional.of(load(revision));
  }

  default boolean existsByCategoryId(Long categoryId) {
    return selectCountByQuery(
            QueryWrapper.create().where(new QueryColumn("category_id").eq(categoryId)))
        > 0;
  }

  default boolean existsByPortalChannelId(Long portalChannelId) {
    return selectCountByQuery(
            QueryWrapper.create().where(new QueryColumn("portal_channel_id").eq(portalChannelId)))
        > 0;
  }

  /** 标签 ID 被任何历史修订引用时禁止删除字典项；检查覆盖关联表而非当前指针。 */
  default boolean existsByTagIdsContains(Long tagId) {
    Object count = Db.selectObject("select count(*) from cms_revision_tag where tag_id = ?", tagId);
    return ((Number) count).longValue() > 0;
  }

  default boolean existsByCoverId(Long coverId) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("cover_id").eq(coverId)))
        > 0;
  }

  /** 附件被任何历史修订引用时禁止删除文件；检查覆盖关联表而非当前指针。 */
  default boolean existsByAttachmentIdsContains(Long fileId) {
    Object count =
        Db.selectObject("select count(*) from cms_revision_file where file_id = ?", fileId);
    return ((Number) count).longValue() > 0;
  }

  /** 只由彻底删除内容的事务调用，普通下线和回收保留历史修订；先清关联表避免外键残留。 */
  default void deleteByNoticeId(Long noticeId) {
    Db.updateBySql(
        "delete from cms_revision_tag where revision_id in"
            + " (select id from cms_revision where notice_id = ?)",
        noticeId);
    Db.updateBySql(
        "delete from cms_revision_file where revision_id in"
            + " (select id from cms_revision where notice_id = ?)",
        noticeId);
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("notice_id").eq(noticeId)));
  }

  /** 装配标签 ID 与附件 ID 集合；展示附件时仍按当前授权重新验证。 */
  default ContentRevision load(ContentRevision revision) {
    Set<Long> tagIds = new HashSet<>();
    for (var row :
        Db.selectListBySql(
            "select tag_id from cms_revision_tag where revision_id = ?", revision.getId())) {
      tagIds.add(row.getLong("tag_id"));
    }
    revision.setTagIds(tagIds);
    Set<Long> attachmentIds = new HashSet<>();
    for (var row :
        Db.selectListBySql(
            "select file_id from cms_revision_file where revision_id = ?", revision.getId())) {
      attachmentIds.add(row.getLong("file_id"));
    }
    revision.setAttachmentIds(attachmentIds);
    return revision;
  }

  /** 保存修订后在同一事务全量重建标签与附件关联；调用方必须已完成主表保存。 */
  default void syncCollections(ContentRevision revision) {
    Db.deleteBySql("delete from cms_revision_tag where revision_id = ?", revision.getId());
    for (Long tagId : revision.getTagIds()) {
      Db.updateBySql(
          "insert into cms_revision_tag(revision_id, tag_id) values (?, ?)",
          revision.getId(),
          tagId);
    }
    Db.deleteBySql("delete from cms_revision_file where revision_id = ?", revision.getId());
    for (Long fileId : revision.getAttachmentIds()) {
      Db.updateBySql(
          "insert into cms_revision_file(revision_id, file_id) values (?, ?)",
          revision.getId(),
          fileId);
    }
  }
}
