-- 并行与固定版本子流程仅扩展新增实例；旧实例执行快照为空，继续使用原冻结模型。
ALTER TABLE ops_flow_request
    ADD COLUMN execution_state LONGTEXT NULL COMMENT '服务器持久执行游标JSON；保存并行支路、汇合等待、固定子申请和可恢复失败状态；旧单线实例为空',
    ADD COLUMN parent_request_id BIGINT NULL COMMENT '父审批申请编号；仅服务器创建子流程时写入，普通提交不接受该字段',
    ADD COLUMN parent_token_id VARCHAR(40) NULL COMMENT '父申请调用子流程的稳定游标UUID；同一游标只能建立一次子申请',
    ADD COLUMN root_request_id BIGINT NULL COMMENT '父子申请树的根申请编号；运行写操作先锁根后锁子，避免反向锁顺序',
    ADD UNIQUE KEY uk_flow_child_token (parent_request_id, parent_token_id),
    ADD KEY idx_flow_request_root (root_request_id),
    ADD CONSTRAINT fk_flow_child_parent FOREIGN KEY (parent_request_id) REFERENCES ops_flow_request (id);
ALTER TABLE ops_flow_task
    ADD COLUMN execution_token_id VARCHAR(40) NULL COMMENT '所属执行游标UUID；并行支路以游标和办理批次核验待办，旧单线任务为空',
    ADD KEY idx_flow_task_token (request_id, execution_token_id, node_visit);
