-- 临时委托与人员交接：新字段可空，旧任务不改变归属；不修改历史模型或审批结果。
CREATE TABLE ops_flow_delegation (
  id bigint NOT NULL AUTO_INCREMENT COMMENT '临时委托主键，数据库生成；不是审批任务编号',
  created_at datetime(6) NOT NULL COMMENT '委托创建时间，服务端业务本地时间 Asia/Shanghai',
  updated_at datetime(6) NOT NULL COMMENT '委托最近变更时间；仅撤销可更新现有记录',
  version bigint NOT NULL COMMENT 'JPA乐观锁版本；撤销须携带读取版本，不能客户端赋值',
  owner_id bigint NOT NULL COMMENT '委托创建账号，由当前会话决定；不能由请求指定他人',
  owner_name varchar(64) NOT NULL COMMENT '创建时原审批人名称快照，不随用户改名重写',
  target_id bigint NOT NULL COMMENT '受托审批账号；创建和任务激活时重新检查有效权限',
  target_name varchar(64) NOT NULL COMMENT '创建时受托人名称快照，供安排历史展示',
  starts_at datetime(6) NOT NULL COMMENT '委托开始时间，包含此时刻；单条时段最长90天',
  ends_at datetime(6) NOT NULL COMMENT '委托结束时间，不包含此时刻；结束不改写已激活任务',
  definition_ids_json text NOT NULL COMMENT '受限结构JSON对象 ids数组；空数组表示全部流程，否则为发布定义ID集合',
  reason varchar(500) NOT NULL COMMENT '创建时填写的委托原因，历史保留，不允许事后改写',
  revoked_at datetime(6) DEFAULT NULL COMMENT '本人撤销时间；非空不再产生新委托任务，已激活任务需显式交接',
  PRIMARY KEY (id),
  KEY idx_delegation_owner_time (owner_id,revoked_at,starts_at,ends_at),
  KEY idx_delegation_target_time (target_id,revoked_at,starts_at,ends_at),
  CONSTRAINT fk_delegation_owner FOREIGN KEY (owner_id) REFERENCES sys_user (id),
  CONSTRAINT fk_delegation_target FOREIGN KEY (target_id) REFERENCES sys_user (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='不可改写的限时审批委托安排；撤销保留历史，拒绝同一时段双重安排和委托链';

ALTER TABLE ops_flow_task
  ADD original_assignee_id bigint DEFAULT NULL COMMENT '委托或交接前原指定账号ID；逻辑关联sys_user，历史不追溯更改',
  ADD original_assignee_name varchar(64) DEFAULT NULL COMMENT '原指定审批人名称快照；没有替换任务归属时为空',
  ADD delegation_id bigint DEFAULT NULL COMMENT '临时委托记录ID；任务激活时绑定，之后到期或撤销不自动收回此任务',
  ADD assignment_note varchar(500) DEFAULT NULL COMMENT '任务归属说明：委托来源、交接理由或委托不适用原因；不包含隐藏表单字段';
