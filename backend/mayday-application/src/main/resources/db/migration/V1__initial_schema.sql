-- 首次数据库结构；生产升级必须新增 V2/V3，不能修改已执行的迁移。
-- 唯一键、关联表外键与乐观锁共同保证并发写入时的数据一致性。
CREATE TABLE sys_role (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(64) NOT NULL,
 description VARCHAR(500), enabled BOOLEAN NOT NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT
);
CREATE TABLE sys_role_permission (
 role_id BIGINT NOT NULL, permission VARCHAR(100) NOT NULL, PRIMARY KEY(role_id, permission),
 CONSTRAINT fk_permission_role FOREIGN KEY(role_id) REFERENCES sys_role(id)
);
CREATE TABLE sys_role_scope (
 role_id BIGINT NOT NULL, resource VARCHAR(64) NOT NULL, data_scope VARCHAR(32), PRIMARY KEY(role_id, resource),
 CONSTRAINT fk_scope_role FOREIGN KEY(role_id) REFERENCES sys_role(id)
);
CREATE TABLE sys_entry (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(32) NOT NULL, name VARCHAR(100) NOT NULL, code VARCHAR(100) NOT NULL,
 value VARCHAR(2000), description VARCHAR(500), permission VARCHAR(100), path VARCHAR(160), parent_id BIGINT,
 sort_order INT NOT NULL, enabled BOOLEAN NOT NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 CONSTRAINT uk_entry_kind_code UNIQUE(kind, code), INDEX idx_entry_parent(parent_id)
);
CREATE TABLE sys_user (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, password_hash VARCHAR(100) NOT NULL,
 nickname VARCHAR(64) NOT NULL, email VARCHAR(128), phone VARCHAR(32), department_id BIGINT, enabled BOOLEAN NOT NULL,
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, INDEX idx_user_department(department_id)
);
CREATE TABLE sys_user_role (
 user_id BIGINT NOT NULL, role_id BIGINT NOT NULL, PRIMARY KEY(user_id, role_id),
 CONSTRAINT fk_user_role_user FOREIGN KEY(user_id) REFERENCES sys_user(id),
 CONSTRAINT fk_user_role_role FOREIGN KEY(role_id) REFERENCES sys_role(id)
);
CREATE TABLE sys_session (
 token_hash VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL, expires_at TIMESTAMP(6) NOT NULL,
 INDEX idx_session_expiry(expires_at), CONSTRAINT fk_session_user FOREIGN KEY(user_id) REFERENCES sys_user(id)
);
CREATE TABLE sys_audit_log (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(64), method VARCHAR(12), path VARCHAR(255), status INT NOT NULL,
 duration_ms BIGINT NOT NULL, ip VARCHAR(64), created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 INDEX idx_audit_created(created_at)
);
CREATE TABLE cms_notice (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(160) NOT NULL, category VARCHAR(32) NOT NULL, summary VARCHAR(500),
 content TEXT NOT NULL, published BOOLEAN NOT NULL, author_id BIGINT NOT NULL, department_id BIGINT, author_name VARCHAR(64),
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 INDEX idx_notice_published(published, created_at), INDEX idx_notice_author(author_id), INDEX idx_notice_department(department_id)
);
