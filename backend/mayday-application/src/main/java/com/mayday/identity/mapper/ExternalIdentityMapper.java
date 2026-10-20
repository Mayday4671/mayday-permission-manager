package com.mayday.identity.mapper;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;

/** 企业身份绑定表（sys_external_identity）的 SQL 收口。 */
@Mapper
public interface ExternalIdentityMapper {
  /** 同账号同提供方只允许一个绑定。 */
  default long countByUserAndProvider(Long userId, String providerId) {
    return ((Number)
            Db.selectObject(
                "select count(*) from sys_external_identity where user_id=? and provider_id=?",
                userId,
                providerId))
        .longValue();
  }

  /** 写入新绑定；签发方与主体均存摘要。 */
  default void insertBinding(
      String id,
      Long userId,
      String providerId,
      String issuerHash,
      String subjectHash,
      java.time.Instant createdAt) {
    Db.updateBySql(
        "insert into sys_external_identity(id,user_id,provider_id,issuer_hash,subject_hash,created_at) values(?,?,?,?,"
            + "?,?)",
        id,
        userId,
        providerId,
        issuerHash,
        subjectHash,
        java.sql.Timestamp.from(createdAt));
  }

  /** 按企业身份三元组定位绑定映射；先锁账号再核验，保持与解绑相同的锁序。 */
  default List<Row> findByIdentity(String providerId, String issuerHash, String subjectHash) {
    return Db.selectListBySql(
        "select id,user_id from sys_external_identity where provider_id=? and issuer_hash=? and subject_hash=?",
        providerId,
        issuerHash,
        subjectHash);
  }

  /** 锁定并确认映射仍属于该账号。 */
  default long countLocked(String id, Long userId) {
    return Db.selectListBySql(
            "select id from sys_external_identity where id=? and user_id=? for update", id, userId)
        .size();
  }

  /** 读取绑定的提供方摘要，供解绑前的存在性校验。 */
  default List<Row> findProvider(String id, Long userId) {
    return Db.selectListBySql(
        "select provider_id from sys_external_identity where id=? and user_id=?", id, userId);
  }

  /** 绑定流程中锁定目标行核验签发方摘要。 */
  default List<Row> lockBinding(String id, Long userId) {
    return Db.selectListBySql(
        "select provider_id,issuer_hash from sys_external_identity where id=? and user_id=? for update",
        id,
        userId);
  }

  /** 登录成功刷新最近登录时间。 */
  default void touchLogin(String id, Instant now) {
    Db.updateBySql(
        "update sys_external_identity set last_login_at=? where id=?", Timestamp.from(now), id);
  }

  /** 绑定列表按时间倒序；提供方名称由服务层匹配。 */
  default List<Row> bindings(Long userId) {
    return Db.selectListBySql(
        "select id,provider_id,created_at,last_login_at from sys_external_identity"
            + " where user_id=? order by created_at desc",
        userId);
  }

  /** 解绑精确删除本人绑定；影响行数即结果。 */
  default int delete(String id, Long userId) {
    return Db.updateBySql("delete from sys_external_identity where id=? and user_id=?", id, userId);
  }

  /** 账号清理：删除全部企业身份绑定。 */
  default void deleteByUser(Long userId) {
    Db.updateBySql("delete from sys_external_identity where user_id=?", userId);
  }
}
