-- 企业身份材料与业务授权隔离；外部账号绝不按邮箱/角色声明自动创建或扩权。
CREATE TABLE sys_external_identity (
  id varchar(36) NOT NULL COMMENT '随机绑定标识；不暴露提供方原始 subject',
  user_id bigint NOT NULL COMMENT '显式绑定的本地用户；权限始终来自本地有效角色',
  provider_id varchar(32) NOT NULL COMMENT '部署注册的 OIDC 提供方标识，不能提交任意请求地址',
  issuer_hash varchar(64) NOT NULL COMMENT 'OIDC 精确 issuer 的 SHA-256 摘要；阻止跨发行方主体碰撞',
  subject_hash varchar(64) NOT NULL COMMENT '验签后 subject 的 SHA-256 摘要；不使用可变邮箱标识身份',
  created_at datetime(6) NOT NULL COMMENT '本人近期再认证并完成 OIDC 证明后建立绑定的 UTC 时间',
  last_login_at datetime(6) DEFAULT NULL COMMENT '该绑定最后成功登录的 UTC 时间，失败不更新',
  PRIMARY KEY (id),
  UNIQUE KEY uk_external_subject (provider_id,issuer_hash,subject_hash),
  UNIQUE KEY uk_external_user_provider (user_id,provider_id),
  CONSTRAINT fk_external_identity_user FOREIGN KEY (user_id) REFERENCES sys_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已证明双方身份的企业单点登录绑定；不存访问令牌';

CREATE TABLE sys_mfa_credential (
  user_id bigint NOT NULL COMMENT '每个本地账号最多一份已确认的 TOTP 密钥',
  secret_cipher text NOT NULL COMMENT '独立部署密钥 AES-256-GCM 加密的 Base32 密钥，带用途认证标签',
  revision varchar(36) NOT NULL COMMENT '随机凭据代际；变更后旧登录挑战与恢复码失效',
  last_step bigint NOT NULL COMMENT '最后接受的 30 秒 TOTP 计数；行锁保证跨节点也拒绝重放',
  created_at datetime(6) NOT NULL COMMENT '真实验证码确认开通的 UTC 时间，不把扫码视为开通',
  PRIMARY KEY (user_id),
  CONSTRAINT fk_mfa_credential_user FOREIGN KEY (user_id) REFERENCES sys_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='多因素认证已开通密钥；恢复/轮换必须证明本地身份';

CREATE TABLE sys_mfa_recovery (
  code_hash varchar(64) NOT NULL COMMENT '128 位随机恢复码 SHA-256 摘要，明文仅创建时返回一次',
  user_id bigint NOT NULL COMMENT '恢复码所属本地账号；不能代替密码或企业身份认证',
  credential_revision varchar(36) NOT NULL COMMENT '关联当前 MFA 密钥代际，旧代际不得再登录',
  used_at datetime(6) DEFAULT NULL COMMENT '原子消费时间；并发提交只能一个成功，空值表示未使用',
  PRIMARY KEY (code_hash),
  KEY ix_mfa_recovery_user (user_id,used_at),
  CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (user_id) REFERENCES sys_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='一次性 MFA 恢复码；无需存可逆明文';

CREATE TABLE sys_identity_challenge (
  token_hash varchar(64) NOT NULL COMMENT '256 位随机挑战凭证 SHA-256 摘要，原值不入数据库',
  purpose varchar(16) NOT NULL COMMENT '封闭用途：MFA_LOGIN、MFA_ENROLL、OIDC_LOGIN、OIDC_BIND',
  user_id bigint DEFAULT NULL COMMENT '本地账号；匿名企业登录在验签并查询显式绑定后才能确定',
  source_hash varchar(64) NOT NULL COMMENT '发起请求来源地址摘要，MFA 挑战不可跨来源使用',
  browser_hash varchar(64) DEFAULT NULL COMMENT 'OIDC HttpOnly 浏览器关联 cookie 摘要，拒绝登录 CSRF',
  session_hash varchar(64) DEFAULT NULL COMMENT '绑定操作的原 Bearer 会话摘要；回调要求同一仍有效会话',
  credential_hash varchar(64) DEFAULT NULL COMMENT '创建时本地密码摘要的再次散列；改密后挑战失效',
  credential_revision varchar(36) DEFAULT NULL COMMENT '创建时 MFA 代际；关闭/重新开通后挑战失效',
  payload_cipher text DEFAULT NULL COMMENT 'AES-GCM 加密 nonce、PKCE 或待确认密钥，不存企业访问令牌',
  expires_at datetime(6) NOT NULL COMMENT '短期 UTC 到期时间；到期边界拒绝，不允许延长',
  consumed_at datetime(6) DEFAULT NULL COMMENT '一次性消费时间；OIDC 交换开始即消费，失败不得重放 code',
  failed_attempts int NOT NULL DEFAULT 0 COMMENT '挑战内失败次数，最多 5 次；事务独立提交保证错误不回滚计数',
  created_at datetime(6) NOT NULL COMMENT '挑战创建 UTC 时间，用于清理和排查，不存来源明文',
  PRIMARY KEY (token_hash),
  KEY ix_identity_challenge_expiry (expires_at),
  KEY ix_identity_challenge_user (user_id,purpose),
  CONSTRAINT fk_identity_challenge_user FOREIGN KEY (user_id) REFERENCES sys_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨进程共享的身份证明挑战；默认业务会话不使用 cookie';
