ALTER TABLE sys_entry ADD group_name VARCHAR(64) NOT NULL DEFAULT '通用',
 ADD value_type VARCHAR(16) NOT NULL DEFAULT 'TEXT', ADD built_in BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE sys_entry SET group_name='网站',built_in=TRUE WHERE kind='settings'
 AND code IN('site.name','site.contact','site.description','site.copyright','site.title','site.keywords','site.phone','site.address','site.icp');
UPDATE sys_entry SET value_type='EMAIL' WHERE kind='settings' AND code='site.contact';
