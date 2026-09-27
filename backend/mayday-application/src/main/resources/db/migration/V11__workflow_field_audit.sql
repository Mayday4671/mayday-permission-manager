-- 表单当前值可以由具有节点字段写权限的审批人调整；原始提交与每次修改独立保留。
ALTER TABLE ops_flow_request ADD COLUMN submitted_form_data LONGTEXT NULL;
UPDATE ops_flow_request SET submitted_form_data = form_data WHERE form_data IS NOT NULL;
ALTER TABLE ops_flow_decision ADD COLUMN changes_json LONGTEXT NULL;
