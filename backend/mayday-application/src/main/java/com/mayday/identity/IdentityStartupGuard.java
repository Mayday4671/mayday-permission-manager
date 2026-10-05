package com.mayday.identity;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

/** 迁移完成后的持久 MFA 密钥门禁；关闭新开通开关不代表可以遗失已有账号的加密密钥。 */
@Component
@RequiredArgsConstructor
@DependsOnDatabaseInitialization
public class IdentityStartupGuard implements InitializingBean {
  private final IdentitySecrets secrets;
  private final JdbcTemplate jdbc;

  /** 逐行验证持久密钥，不加载完整凭据集合；错误只说明配置不匹配，不输出共享密钥或密文。 */
  @Override
  public void afterPropertiesSet() {
    jdbc.query(
        "select user_id,secret_cipher from sys_mfa_credential",
        (RowCallbackHandler)
            row -> {
              try {
                secrets.decrypt(row.getString("secret_cipher"), "mfa:" + row.getLong("user_id"));
              } catch (IllegalStateException invalid) {
                throw new IllegalStateException(
                    "已有 MFA 凭据无法解密，请恢复与数据库匹配的 MAYDAY_IDENTITY_ENCRYPTION_KEY", invalid);
              }
            });
  }
}
