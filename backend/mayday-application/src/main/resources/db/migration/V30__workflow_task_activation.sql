-- 实际激活是节点字段授权的持久凭证。顺签 WAITING 在建单时已存在但没有办理资格；
-- 退回/终止会把其改为 CANCELLED，因此不能仅用非 WAITING 状态判断曾获得字段授权。
ALTER TABLE ops_flow_task
    ADD COLUMN activated_at DATETIME(6) NULL COMMENT '此任务实际取得节点办理或抄送资格的时间；未轮到的顺签和未激活取消记录为空；当前值按当前轮、历史按对应轮的激活证据裁剪字段及附件';

-- 激活事件与任务同业务事务保存，投递成功/跳过不会删除事件；唯一事件键精确包含申请和任务编号。
-- 因此旧 CANCELLED 任务只有存在对应事件才回填，避免把被取消的排队人员误认为历史授权人员。
UPDATE ops_flow_task t
JOIN ops_event e ON e.event_key = CONCAT('request:', t.request_id, ':task:', t.id)
SET t.activated_at = e.created_at;

-- 对早期没有事务发件箱证据的已实际办理/待办/抄送记录保留兼容；这些状态不会由排队取消产生。
-- 未知 CANCELLED 与 WAITING 保持 NULL：缺乏实际到达节点的可信证据时，保守拒绝新增字段授权。
UPDATE ops_flow_task
SET activated_at = created_at
WHERE activated_at IS NULL
  AND status IN ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'TRANSFERRED', 'COPIED');
