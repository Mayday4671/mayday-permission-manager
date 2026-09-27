-- 流程草稿与发布版本分离；实例保存发布模型、表单和审批人解析快照。
ALTER TABLE ops_flow_definition ADD COLUMN category_id BIGINT NULL,
 ADD COLUMN business_type VARCHAR(24) NOT NULL DEFAULT 'GENERAL',
 ADD COLUMN draft_schema LONGTEXT NULL, ADD COLUMN published_version_id BIGINT NULL;
CREATE TABLE ops_flow_version (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 definition_id BIGINT NOT NULL, version_number INT NOT NULL, schema_json LONGTEXT NOT NULL, publisher_name VARCHAR(64),
 UNIQUE KEY uk_flow_version(definition_id,version_number),
 FOREIGN KEY(definition_id) REFERENCES ops_flow_definition(id)
);
ALTER TABLE ops_flow_request ADD COLUMN definition_version_id BIGINT NULL,
 ADD COLUMN schema_snapshot LONGTEXT NULL, ADD COLUMN form_data LONGTEXT NULL,
 ADD COLUMN resolved_assignees LONGTEXT NULL, ADD COLUMN current_node_id VARCHAR(40) NULL,
 ADD COLUMN business_type VARCHAR(24) NOT NULL DEFAULT 'GENERAL', ADD COLUMN business_id BIGINT NULL,
 ADD COLUMN business_revision_id BIGINT NULL, ADD COLUMN completed_at DATETIME(6) NULL;
CREATE TABLE ops_flow_task (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 request_id BIGINT NOT NULL,node_id VARCHAR(40) NOT NULL,node_name VARCHAR(80) NOT NULL,
 assignee_id BIGINT NOT NULL,assignee_name VARCHAR(64) NOT NULL,status VARCHAR(20) NOT NULL,
 mandatory BOOLEAN NOT NULL DEFAULT FALSE,decided_at DATETIME(6) NULL,
 INDEX idx_task_pending(assignee_id,status,request_id),FOREIGN KEY(request_id) REFERENCES ops_flow_request(id)
);
ALTER TABLE ops_flow_decision ADD COLUMN node_id VARCHAR(40) NULL,
 ADD COLUMN node_name VARCHAR(80) NULL,ADD COLUMN target_user_id BIGINT NULL,
 ADD COLUMN target_user_name VARCHAR(64) NULL;
CREATE TABLE ops_request_file (
 request_id BIGINT NOT NULL, file_id BIGINT NOT NULL,
 PRIMARY KEY(request_id,file_id),FOREIGN KEY(request_id) REFERENCES ops_flow_request(id),FOREIGN KEY(file_id) REFERENCES ops_file(id)
);
-- 业务事务写入事件；另一个事务投递。成功唯一键、失败退避及重启恢复保证不丢失、不重复。
CREATE TABLE ops_event (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,created_at DATETIME(6) NOT NULL,updated_at DATETIME(6) NOT NULL,version BIGINT,
 event_key VARCHAR(160) NOT NULL UNIQUE,request_id BIGINT NOT NULL,recipient_id BIGINT NOT NULL,
 title VARCHAR(160) NOT NULL,body VARCHAR(1000) NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
 attempts INT NOT NULL DEFAULT 0,next_attempt_at DATETIME(6) NOT NULL,last_error VARCHAR(500),
 INDEX idx_event_retry(status,next_attempt_at)
);
INSERT INTO sys_entry(kind,name,code,sort_order,enabled,created_at,updated_at,version)
 VALUES('approvalcategories','通用审批','general',0,TRUE,NOW(6),NOW(6),0),
 ('approvalcategories','内容审核','content',1,TRUE,NOW(6),NOW(6),0);
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',p.name,p.code,p.path,p.permission,p.sort_order,TRUE,NOW(6),NOW(6),0
FROM (
 SELECT '审批分类' name,'approvalcategories' code,'/admin/approval-categories' path,'approvalcategories:view' permission,80 sort_order
 UNION ALL SELECT '流程定义','workflows','/admin/workflows','workflows:view',81
 UNION ALL SELECT '审批申请','requests','/admin/requests','requests:view',82
 UNION ALL SELECT '审批待办','tasks','/admin/tasks','requests:approve',83
) p WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND e.path=p.path);

