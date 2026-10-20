package com.mayday.identity.mapper;

import com.mayday.identity.IdentityStore.Challenge;
import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 身份挑战表（sys_identity_challenge）的 SQL 收口；一次性消费与失败计数都是原子更新。 */
@Mapper
public interface IdentityChallengeMapper {
  /** 每次签发前有界清理过期挑战。 */
  default void purgeExpired(Instant before) {
    Db.updateBySql(
        "delete from sys_identity_challenge where expires_at < ? limit 1000",
        Timestamp.from(before));
  }

  /** 写入新挑战；令牌、来源与浏览器关联只存摘要。 */
  default void insert(Challenge challenge, Instant expiresAt) {
    Db.updateBySql(
        "insert into sys_identity_challenge(token_hash,purpose,user_id,source_hash,browser_hash,session_hash,credential_hash,credential_revision,payload_cipher,expires_at,created_at) values(?,?,?,?,?,?,?,?,?,?,?)",
        challenge.hash(),
        challenge.purpose(),
        challenge.userId(),
        challenge.sourceHash(),
        challenge.browserHash(),
        challenge.sessionHash(),
        challenge.credentialHash(),
        challenge.credentialRevision(),
        challenge.payloadCipher(),
        Timestamp.from(expiresAt),
        Timestamp.from(Instant.now()));
  }

  /** 按令牌摘要读取原始行；过滤与校验由服务层完成。 */
  default Optional<Row> find(String tokenHash) {
    return Optional.ofNullable(
        Db.selectOneBySql("select * from sys_identity_challenge where token_hash=?", tokenHash));
  }

  /** 一次性消费：未消费、失败次数未超限且未过期才成功。 */
  default int consume(String hash, Instant now) {
    return Db.updateBySql(
        "update sys_identity_challenge set consumed_at=? where token_hash=? and consumed_at is null and failed_attempts<5 and expires_at>?",
        Timestamp.from(now),
        hash,
        Timestamp.from(now));
  }

  /** 失败计数独立提交，不随业务回滚。 */
  default void fail(String hash) {
    Db.updateBySql(
        "update sys_identity_challenge set failed_attempts=least(failed_attempts+1,5) where token_hash=? and consumed_at is null",
        hash);
  }

  /** 账号身份材料清理；通过授权与保护检查后精确删除。 */
  default void deleteByUser(Long userId) {
    Db.updateBySql("delete from sys_identity_challenge where user_id=?", userId);
  }
}
