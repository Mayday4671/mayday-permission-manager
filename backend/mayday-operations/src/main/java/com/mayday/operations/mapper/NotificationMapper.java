package com.mayday.operations.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.Notification;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.io.Serializable;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import org.apache.ibatis.annotations.Mapper;

/**
 * 发布、撤回及编辑共用行锁；乐观版本检查仍用于拒绝过时表单。
 *
 * <p>收件人与附件存于 ops_notification_target / ops_notification_file，标记为非列并由仓储读取时装配、保存时重建。
 */
@Mapper
public interface NotificationMapper extends EntityMapper<Notification> {
  default Optional<Notification> lockById(Long id) {
    Notification notification =
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate());
    return notification == null ? Optional.empty() : Optional.of(load(notification));
  }

  /** 附件被任何历史通知引用时禁止删除文件；检查覆盖关联表而非当前指针。 */
  default boolean existsByAttachmentIdsContains(Long fileId) {
    Object count =
        Db.selectObject("select count(*) from ops_notification_file where file_id = ?", fileId);
    return ((Number) count).longValue() > 0;
  }

  default Optional<Notification> findByEventKey(String eventKey) {
    Notification notification =
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("event_key").eq(eventKey)));
    return notification == null ? Optional.empty() : Optional.of(load(notification));
  }

  /** 按主键载入并装配收件人与附件集合。 */
  @Override
  default Optional<Notification> findById(Serializable id) {
    Notification notification = selectOneById(id);
    return notification == null ? Optional.empty() : Optional.of(load(notification));
  }

  /** 装配收件人与附件集合；发布前由服务层校验收件人范围。 */
  default Notification load(Notification notification) {
    Set<Long> recipientIds = new HashSet<>();
    for (var row :
        Db.selectListBySql(
            "select target_id from ops_notification_target where notification_id = ?",
            notification.getId())) {
      recipientIds.add(row.getLong("target_id"));
    }
    notification.setRecipientIds(recipientIds);
    Set<Long> attachmentIds = new HashSet<>();
    for (var row :
        Db.selectListBySql(
            "select file_id from ops_notification_file where notification_id = ?",
            notification.getId())) {
      attachmentIds.add(row.getLong("file_id"));
    }
    notification.setAttachmentIds(attachmentIds);
    return notification;
  }

  /** 保存主表后在同一事务全量重建收件人与附件关联。 */
  default void syncCollections(Notification notification) {
    Db.deleteBySql(
        "delete from ops_notification_target where notification_id = ?", notification.getId());
    for (Long targetId : notification.getRecipientIds()) {
      Db.updateBySql(
          "insert into ops_notification_target(notification_id, target_id) values (?, ?)",
          notification.getId(),
          targetId);
    }
    Db.deleteBySql(
        "delete from ops_notification_file where notification_id = ?", notification.getId());
    for (Long fileId : notification.getAttachmentIds()) {
      Db.updateBySql(
          "insert into ops_notification_file(notification_id, file_id) values (?, ?)",
          notification.getId(),
          fileId);
    }
  }
}
