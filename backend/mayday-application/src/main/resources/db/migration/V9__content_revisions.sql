-- 主记录保留作者、范围和版本指针；正文及展示信息进入不可变修订，编辑不会覆盖线上内容。
ALTER TABLE cms_notice ADD draft_revision_id BIGINT, ADD live_revision_id BIGINT,
 ADD draft_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT', ADD requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
 ADD published_at DATETIME(6), ADD live_offline_at DATETIME(6),
 ADD scheduled_revision_id BIGINT, ADD scheduled_publish_at DATETIME(6), ADD scheduled_offline_at DATETIME(6),
 ADD scheduled_actor_id BIGINT, ADD schedule_error VARCHAR(500),
 ADD view_count BIGINT NOT NULL DEFAULT 0;
CREATE TABLE cms_revision (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, notice_id BIGINT NOT NULL, revision_number INT NOT NULL,
 title VARCHAR(160) NOT NULL, category_id BIGINT NOT NULL, summary VARCHAR(500), content TEXT NOT NULL,
 visibility VARCHAR(24) NOT NULL DEFAULT 'PUBLIC', cover_id BIGINT, sort_order INT NOT NULL DEFAULT 0,
 pinned BOOLEAN NOT NULL DEFAULT FALSE, recommended BOOLEAN NOT NULL DEFAULT FALSE,
 seo_title VARCHAR(160), seo_keywords VARCHAR(250), seo_description VARCHAR(500),
 approval_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT', approval_request_id BIGINT,
 editor_id BIGINT, editor_name VARCHAR(64),
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 UNIQUE(notice_id,revision_number), FOREIGN KEY(notice_id) REFERENCES cms_notice(id) ON DELETE CASCADE,
 FOREIGN KEY(category_id) REFERENCES sys_entry(id), FOREIGN KEY(cover_id) REFERENCES ops_file(id)
);
CREATE TABLE cms_revision_tag (
 revision_id BIGINT NOT NULL, tag_id BIGINT NOT NULL, PRIMARY KEY(revision_id,tag_id),
 FOREIGN KEY(revision_id) REFERENCES cms_revision(id) ON DELETE CASCADE, FOREIGN KEY(tag_id) REFERENCES sys_entry(id)
);
CREATE TABLE cms_revision_file (
 revision_id BIGINT NOT NULL, file_id BIGINT NOT NULL, PRIMARY KEY(revision_id,file_id),
 FOREIGN KEY(revision_id) REFERENCES cms_revision(id) ON DELETE CASCADE, FOREIGN KEY(file_id) REFERENCES ops_file(id)
);
CREATE TABLE cms_publication (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, notice_id BIGINT NOT NULL, revision_id BIGINT NOT NULL,
 published_at DATETIME(6) NOT NULL, offline_at DATETIME(6), operator_name VARCHAR(64), reason VARCHAR(100),
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 FOREIGN KEY(notice_id) REFERENCES cms_notice(id) ON DELETE CASCADE,
 FOREIGN KEY(revision_id) REFERENCES cms_revision(id)
);
-- 为旧标签补稳定 ID。原名称与正文列不改写，便于升级前后原数据比对和回滚排查。
INSERT INTO sys_entry(kind,name,code,sort_order,enabled,created_at,updated_at,version)
SELECT 'tags',t.tag,CONCAT('legacy_tag_',MIN(t.notice_id),'_',LEFT(SHA2(t.tag,256),16)),0,TRUE,NOW(6),NOW(6),0
FROM cms_notice_tag t WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='tags' AND e.name=t.tag) GROUP BY t.tag;
INSERT INTO cms_revision(notice_id,revision_number,title,category_id,summary,content,editor_id,editor_name,created_at,updated_at,version)
SELECT n.id,1,n.title,(SELECT MIN(e.id) FROM sys_entry e WHERE e.kind='categories' AND e.name=n.category),n.summary,
 CONCAT('<p>',REPLACE(REPLACE(REPLACE(REPLACE(n.content,'&','&amp;'),'<','&lt;'),'>','&gt;'),CHAR(10),'<br>'),'</p>'),
 n.author_id,n.author_name,n.created_at,n.updated_at,0 FROM cms_notice n;
INSERT INTO cms_revision_tag SELECT r.id,(SELECT MIN(e.id) FROM sys_entry e WHERE e.kind='tags' AND e.name=t.tag)
FROM cms_revision r JOIN cms_notice_tag t ON t.notice_id=r.notice_id;
UPDATE cms_notice n JOIN cms_revision r ON r.notice_id=n.id SET n.draft_revision_id=r.id,
 n.live_revision_id=IF(n.published AND n.deleted_at IS NULL,r.id,NULL),
 n.draft_status=IF(n.published AND n.deleted_at IS NULL,'PUBLISHED','DRAFT'),n.published_at=IF(n.published,n.updated_at,NULL);
INSERT INTO cms_publication(notice_id,revision_id,published_at,operator_name,reason,created_at,updated_at,version)
SELECT n.id,n.live_revision_id,n.published_at,n.author_name,'旧版迁移',n.created_at,n.updated_at,0 FROM cms_notice n WHERE n.live_revision_id IS NOT NULL;
INSERT INTO sys_entry(kind,name,code,value,value_type,group_name,built_in,sort_order,enabled,created_at,updated_at,version)
SELECT 'settings','内容必须审核','content.requireApproval','false','BOOLEAN','内容',TRUE,0,TRUE,NOW(6),NOW(6),0
WHERE NOT EXISTS(SELECT 1 FROM sys_entry WHERE kind='settings' AND code='content.requireApproval');
INSERT INTO sys_entry(kind,name,code,path,permission,sort_order,enabled,created_at,updated_at,version)
SELECT 'menus',p.name,p.code,p.path,p.permission,p.sort_order,TRUE,NOW(6),NOW(6),0 FROM (
 SELECT '内容分类' name,'categories' code,'/admin/categories' path,'categories:view' permission,30 sort_order
 UNION ALL SELECT '内容标签','tags','/admin/tags','tags:view',31
 UNION ALL SELECT '内容回收站','recycle','/admin/recycle','notices:view',32
) p WHERE NOT EXISTS(SELECT 1 FROM sys_entry e WHERE e.kind='menus' AND (e.code=p.code OR e.path=p.path));
