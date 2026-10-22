-- 保留旧类型和值字段以便核对升级前快照；新业务只从独立字典项读取。
CREATE TABLE sys_dictionary_item (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, dictionary_id BIGINT NOT NULL,
 label VARCHAR(100) NOT NULL, value VARCHAR(100) NOT NULL, color VARCHAR(20),
 sort_order INT NOT NULL, enabled BOOLEAN NOT NULL,
 created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL, version BIGINT,
 UNIQUE KEY uk_dictionary_value(dictionary_id,value),
 CONSTRAINT fk_dictionary_type FOREIGN KEY(dictionary_id) REFERENCES sys_entry(id)
);
-- JSON_QUOTE 正确保留旧标签内的引号与反斜线；历史结构本来就以英文逗号分隔。
-- ROW_NUMBER 去掉重复项；账号状态使用稳定布尔字符串，修改显示名称不改变实际业务值。
INSERT INTO sys_dictionary_item(dictionary_id,label,value,color,sort_order,enabled,created_at,updated_at,version)
SELECT dictionary_id,label,value,NULL,position,TRUE,NOW(6),NOW(6),0 FROM (
 SELECT e.id dictionary_id, TRIM(j.label) label,
 CASE WHEN e.code='user.status' AND TRIM(j.label)='启用' THEN 'true'
      WHEN e.code='user.status' AND TRIM(j.label)='停用' THEN 'false' ELSE TRIM(j.label) END value,
 j.position, ROW_NUMBER() OVER(PARTITION BY e.id,TRIM(j.label) ORDER BY j.position) duplicate_rank
 FROM sys_entry e JOIN JSON_TABLE(CONCAT('[',REPLACE(JSON_QUOTE(COALESCE(e.value,'')),',','","'),']'),
 '$[*]' COLUMNS(position FOR ORDINALITY,label VARCHAR(100) PATH '$')) j
 WHERE e.kind='dictionaries' AND TRIM(j.label)<>''
) migrated WHERE duplicate_rank=1;
