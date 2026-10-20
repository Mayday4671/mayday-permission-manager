package com.mayday.content.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.content.ContentPublication;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 发布记录保留每次实际上线区间；关闭当前记录与切换内容指针在应用层同一事务内执行。 */
@Mapper
public interface ContentPublicationMapper extends EntityMapper<ContentPublication> {
  default List<ContentPublication> findByNoticeIdAndOfflineAtIsNull(Long noticeId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("notice_id").eq(noticeId))
            .and(new QueryColumn("offline_at").isNull()));
  }

  /** 永久删除内容才清除关联发布历史；普通回收保留历史以便恢复和审计。 */
  default void deleteByNoticeId(Long noticeId) {
    deleteByQuery(QueryWrapper.create().where(new QueryColumn("notice_id").eq(noticeId)));
  }
}
