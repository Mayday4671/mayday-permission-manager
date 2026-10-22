-- 数据库层补充组织引用约束，防止并发删除留下孤立的部门归属。
-- 内容作者保留 ID 和姓名快照；删除账号不会删除其历史内容。
ALTER TABLE sys_entry ADD CONSTRAINT fk_entry_parent FOREIGN KEY (parent_id) REFERENCES sys_entry(id);
ALTER TABLE sys_user ADD CONSTRAINT fk_user_department FOREIGN KEY (department_id) REFERENCES sys_entry(id);
ALTER TABLE cms_notice ADD CONSTRAINT fk_notice_department FOREIGN KEY (department_id) REFERENCES sys_entry(id);
