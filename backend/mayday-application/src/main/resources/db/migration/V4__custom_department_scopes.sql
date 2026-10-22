-- 指定部门授权按资源存储，不修改已有角色的数据范围和权限。
CREATE TABLE sys_role_scope_department (
  role_id BIGINT NOT NULL,
  resource VARCHAR(64) NOT NULL,
  department_id BIGINT NOT NULL,
  PRIMARY KEY(role_id, resource, department_id),
  CONSTRAINT fk_scope_department_role FOREIGN KEY(role_id) REFERENCES sys_role(id),
  CONSTRAINT fk_scope_department_entry FOREIGN KEY(department_id) REFERENCES sys_entry(id)
);
