-- 在途人员修复必须跨提交轮次保留；不能退回重提后再次分派给已经离职的发布人员。
ALTER TABLE ops_flow_request ADD assignment_overrides longtext DEFAULT NULL COMMENT '管理员人员交接形成的实例级节点人员覆盖JSON；退回重提保留，发布模型不改变，未交接时NULL';
