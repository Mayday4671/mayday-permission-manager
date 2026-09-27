-- 新模块的页面入口和角色授权随各模块交付单独配置；此迁移不为旧角色自动追加权限，也不创建尚未实现的导航。
-- 通用管理模块增量迁移；不覆盖现有账号、角色范围或业务内容。
ALTER TABLE sys_session ADD session_id VARCHAR(36), ADD created_at TIMESTAMP(6), ADD last_active_at TIMESTAMP(6), ADD ip VARCHAR(64), ADD device VARCHAR(255);
UPDATE sys_session SET session_id=UUID(), created_at=CURRENT_TIMESTAMP(6), last_active_at=CURRENT_TIMESTAMP(6);
CREATE UNIQUE INDEX uk_session_public_id ON sys_session(session_id);
ALTER TABLE cms_notice ADD deleted_at DATETIME(6);
CREATE INDEX idx_notice_deleted ON cms_notice(deleted_at);
CREATE TABLE ops_message (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, title VARCHAR(160) NOT NULL, content TEXT NOT NULL, sender_id BIGINT, sender_name VARCHAR(64), recipient_id BIGINT NOT NULL, read_at DATETIME(6), INDEX idx_message_recipient(recipient_id,read_at), INDEX idx_message_sender(sender_id));
CREATE TABLE ops_file (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, name VARCHAR(255) NOT NULL, content_type VARCHAR(128) NOT NULL, size BIGINT NOT NULL, owner_id BIGINT, owner_name VARCHAR(64), INDEX idx_file_owner(owner_id));
CREATE TABLE ops_job (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, name VARCHAR(100) NOT NULL, handler VARCHAR(64) NOT NULL, cron VARCHAR(100) NOT NULL, description VARCHAR(500), enabled BOOLEAN NOT NULL, next_run_at DATETIME(6));
CREATE TABLE ops_job_execution (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, job_id BIGINT, job_name VARCHAR(100), status VARCHAR(16), result VARCHAR(1000), duration_ms BIGINT NOT NULL, INDEX idx_execution_job(job_id));
CREATE TABLE ops_flow_definition (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, name VARCHAR(100) NOT NULL, code VARCHAR(64) NOT NULL UNIQUE, description VARCHAR(500), enabled BOOLEAN NOT NULL);
CREATE TABLE ops_flow_step (definition_id BIGINT NOT NULL, step_index INT NOT NULL, approver_id BIGINT NOT NULL, PRIMARY KEY(definition_id,step_index), FOREIGN KEY(definition_id) REFERENCES ops_flow_definition(id));
CREATE TABLE ops_flow_request (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, definition_id BIGINT, definition_name VARCHAR(100), title VARCHAR(160) NOT NULL, content TEXT NOT NULL, applicant_id BIGINT, applicant_name VARCHAR(64), status VARCHAR(20) NOT NULL, current_step INT NOT NULL, current_approver_id BIGINT, INDEX idx_request_applicant(applicant_id), INDEX idx_request_approver(current_approver_id,status));
CREATE TABLE ops_request_step (request_id BIGINT NOT NULL, step_index INT NOT NULL, approver_id BIGINT NOT NULL, PRIMARY KEY(request_id,step_index), FOREIGN KEY(request_id) REFERENCES ops_flow_request(id));
CREATE TABLE ops_flow_decision (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT, request_id BIGINT, actor_id BIGINT, actor_name VARCHAR(64), action VARCHAR(20), comment VARCHAR(500), INDEX idx_decision_request(request_id));
CREATE TABLE sys_user_post (user_id BIGINT NOT NULL, post_id BIGINT NOT NULL, PRIMARY KEY(user_id,post_id), FOREIGN KEY(user_id) REFERENCES sys_user(id), FOREIGN KEY(post_id) REFERENCES sys_entry(id));
CREATE TABLE cms_notice_tag (notice_id BIGINT NOT NULL, tag VARCHAR(32) NOT NULL, PRIMARY KEY(notice_id,tag), FOREIGN KEY(notice_id) REFERENCES cms_notice(id));
INSERT INTO sys_entry(kind,name,code,sort_order,enabled,created_at,updated_at,version) SELECT 'categories',category,CONCAT('category_',MIN(id)),0,TRUE,NOW(6),NOW(6),0 FROM cms_notice GROUP BY category;

CREATE TABLE ops_file_payload (id BIGINT PRIMARY KEY, data LONGBLOB NOT NULL, FOREIGN KEY(id) REFERENCES ops_file(id));
