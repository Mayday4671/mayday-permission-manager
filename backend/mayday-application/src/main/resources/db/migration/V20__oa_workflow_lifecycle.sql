-- OA 办理生命周期：旧申请保持第 1 轮和第 0 批次，不修改历史发布模型或授权。
ALTER TABLE ops_flow_request
  ADD COLUMN run_number INT NOT NULL DEFAULT 1 COMMENT '提交轮次：未提交草稿为0；首次提交为1；修改重提递增',
  ADD COLUMN node_visit INT NOT NULL DEFAULT 0 COMMENT '节点办理批次：每次进入审批或抄送递增，用于隔离退回后的旧决定',
  ADD COLUMN active_path TEXT NULL COMMENT '当前轮实际审批路径JSON，nodes为稳定节点ID数组；退回时裁剪，重提时清空',
  ADD COLUMN submitted_at DATETIME(6) NULL COMMENT '最近一次正式提交时间；未提交草稿为空，不使用草稿创建时间冒充';
UPDATE ops_flow_request SET submitted_at = created_at;
ALTER TABLE ops_flow_request MODIFY COLUMN status VARCHAR(20) NOT NULL COMMENT '申请状态：DRAFT草稿/PENDING审批中/RETURNED待修改/APPROVED通过/REJECTED终止性驳回/WITHDRAWN撤回/CANCELLED管理员终止';

ALTER TABLE ops_flow_task
  ADD COLUMN run_number INT NOT NULL DEFAULT 1 COMMENT '所属提交轮次，与申请重提轮次对应；旧任务只作为历史',
  ADD COLUMN node_visit INT NOT NULL DEFAULT 0 COMMENT '所属节点办理批次；同一节点退回重办不得混用以前的会签结果',
  ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'APPROVAL' COMMENT '任务种类：APPROVAL审批/COPY抄送，抄送不具备决定权限',
  ADD COLUMN read_at DATETIME(6) NULL COMMENT '抄送接收者首次已读时间，空表示未读；审批任务不用此字段';
ALTER TABLE ops_flow_task MODIFY COLUMN status VARCHAR(20) NOT NULL COMMENT '任务状态：WAITING顺签未轮到/PENDING待办/APPROVED通过/REJECTED驳回/RETURNED退回/TRANSFERRED转交/CANCELLED失效/COPIED抄送';
-- 用复合索引接替相同前缀的旧外键辅助索引；同一次 ALTER 保持外键始终有可用索引。
-- 旧库的显式索引与空库的自动索引统一处理，避免两种安装路径产生冗余索引差异。
ALTER TABLE ops_flow_task DROP INDEX request_id, ADD INDEX idx_flow_task_round_visit(request_id, run_number, node_visit);
CREATE INDEX idx_flow_task_copy_reader ON ops_flow_task(assignee_id, kind, read_at);

ALTER TABLE ops_flow_decision
  ADD COLUMN run_number INT NOT NULL DEFAULT 1 COMMENT '决定所属提交轮次；重提不覆盖以前的处理轨迹',
  ADD COLUMN node_visit INT NOT NULL DEFAULT 0 COMMENT '决定所属节点办理批次；进入下一节点前的决定归属于原任务批次',
  ADD COLUMN target_node_id VARCHAR(40) NULL COMMENT '退回目标节点稳定ID；为空表示退回申请人，其他动作不用',
  ADD COLUMN form_snapshot LONGTEXT NULL COMMENT '每轮提交时的完整表单JSON快照；接口按查看人字段权限裁剪，不直接序列化';
