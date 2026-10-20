package com.mayday.identity.mapper;

import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/** 多因素凭据与恢复码表（sys_mfa_credential / sys_mfa_recovery）的 SQL 收口。 */
@Mapper
public interface MfaCredentialMapper {
  /** 当前读并锁定账号唯一凭据行；账号行锁之后执行。 */
  default Optional<Map<String, Object>> lockCredential(Long userId) {
    return Db.<Object>selectListBySql(
            "select secret_cipher,revision,last_step from sys_mfa_credential where user_id=? for update",
            userId)
        .stream()
        .findFirst()
        .map(row -> (Map<String, Object>) row);
  }

  /** 有效恢复码数量；为零表示未储备。 */
  default long countUnusedRecovery(Long userId) {
    return ((Number)
            Db.selectObject(
                "select count(*) from sys_mfa_recovery where user_id=? and used_at is null",
                userId))
        .longValue();
  }

  /** 全表凭据行；启动守卫解密自检使用，行数与账号开通数一致。 */
  default List<Row> selectAllRows() {
    return Db.selectListBySql("select user_id,secret_cipher from sys_mfa_credential");
  }

  /** 已开通凭据数量。 */
  default long countCredential(Long userId) {
    return ((Number)
            Db.selectObject("select count(*) from sys_mfa_credential where user_id=?", userId))
        .longValue();
  }

  /** 开通成功写入凭据；密文由服务层加密。 */
  default void insertCredential(
      Long userId, String secretCipher, String revision, long lastStep, Instant createdAt) {
    Db.updateBySql(
        "insert into sys_mfa_credential(user_id,secret_cipher,revision,last_step,created_at) values(?,?,?,?,?)",
        userId,
        secretCipher,
        revision,
        lastStep,
        Timestamp.from(createdAt));
  }

  /** 写入一条恢复码；只存摘要。 */
  default void insertRecovery(String codeHash, Long userId, String revision) {
    Db.updateBySql(
        "insert into sys_mfa_recovery(code_hash,user_id,credential_revision) values(?,?,?)",
        codeHash,
        userId,
        revision);
  }

  /** 原子消费恢复码；影响行数即验证结果。 */
  default int consumeRecovery(String codeHash, Long userId, String revision, Instant now) {
    return Db.updateBySql(
        "update sys_mfa_recovery set used_at=? where code_hash=? and user_id=? and credential_revision=? and used_at is"
            + " null",
        Timestamp.from(now),
        codeHash,
        userId,
        revision);
  }

  /** TOTP 时间窗前进；只允许向前推进。 */
  default int advanceStep(Long userId, long step) {
    return Db.updateBySql(
        "update sys_mfa_credential set last_step=? where user_id=? and last_step<?",
        step,
        userId,
        step);
  }

  /** 轮换恢复码：只清空旧恢复码，凭据保持不变。 */
  default void deleteRecoveryByUser(Long userId) {
    Db.updateBySql("delete from sys_mfa_recovery where user_id=?", userId);
  }

  /** 解绑或账号清理：删除凭据与恢复码。 */
  default void deleteByUser(Long userId) {
    Db.updateBySql("delete from sys_mfa_recovery where user_id=?", userId);
    Db.updateBySql("delete from sys_mfa_credential where user_id=?", userId);
  }
}
