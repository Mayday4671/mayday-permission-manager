-- 正文、接收范围和每个人的阅读状态分离；收件人快照不随角色或组织调整而漂移。
CREATE TABLE ops_notification (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(160) NOT NULL, summary VARCHAR(500),
 content TEXT NOT NULL, type VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL,
 recipient_type VARCHAR(24) NOT NULL, sender_id BIGINT, sender_name VARCHAR(64),
 published_at DATETIME(6), expires_at DATETIME(6), withdrawn_at DATETIME(6),
 target_type VARCHAR(24), target_id BIGINT,
 event_key VARCHAR(160) UNIQUE,
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 INDEX idx_notification_owner(sender_id,status), INDEX idx_notification_expiry(status,expires_at)
);
CREATE TABLE ops_notification_target (
 notification_id BIGINT NOT NULL, target_id BIGINT NOT NULL, PRIMARY KEY(notification_id,target_id),
 FOREIGN KEY(notification_id) REFERENCES ops_notification(id) ON DELETE CASCADE
);
CREATE TABLE ops_notification_file (
 notification_id BIGINT NOT NULL, file_id BIGINT NOT NULL, PRIMARY KEY(notification_id,file_id),
 FOREIGN KEY(notification_id) REFERENCES ops_notification(id) ON DELETE CASCADE,
 FOREIGN KEY(file_id) REFERENCES ops_file(id)
);
CREATE TABLE ops_delivery (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, notification_id BIGINT NOT NULL, recipient_id BIGINT NOT NULL,
 recipient_name VARCHAR(64) NOT NULL, read_at DATETIME(6),
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 UNIQUE(notification_id,recipient_id), INDEX idx_delivery_recipient(recipient_id,read_at),
 FOREIGN KEY(notification_id) REFERENCES ops_notification(id) ON DELETE CASCADE
);
-- 旧站内信没有发布批次标识，逐条保留为独立通知，避免错误合并不同时间发送的相同标题。
INSERT INTO ops_notification(id,title,summary,content,type,status,recipient_type,sender_id,sender_name,published_at,created_at,updated_at,version)
SELECT id,title,'',CONCAT('<p>',REPLACE(REPLACE(REPLACE(content,'&','&amp;'),'<','&lt;'),'>','&gt;'),'</p>'),
 'NOTICE','PUBLISHED','USERS',sender_id,sender_name,created_at,created_at,updated_at,version FROM ops_message;
INSERT INTO ops_notification_target SELECT id,recipient_id FROM ops_message;
INSERT INTO ops_delivery(id,notification_id,recipient_id,recipient_name,read_at,created_at,updated_at,version)
SELECT m.id,m.id,m.recipient_id,COALESCE(u.nickname,'已删除用户'),m.read_at,m.created_at,m.updated_at,m.version
 FROM ops_message m LEFT JOIN sys_user u ON u.id=m.recipient_id;
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',p.name,p.code,p.path,p.permission,p.sort_order,TRUE,NOW(6),NOW(6),0 FROM (
 SELECT '通知管理' name,'notifications' code,'/admin/notifications' path,'notifications:view' permission,20 sort_order
 UNION ALL SELECT '个人收件箱','messages','/admin/messages','messages:view',21
 UNION ALL SELECT '文件中心','files','/admin/files','files:view',22
) p WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND (e.code=p.code OR e.path=p.path));
