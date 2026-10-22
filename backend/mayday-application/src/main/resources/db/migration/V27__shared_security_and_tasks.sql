-- E5 共享状态：只增加内部持久化支撑，不给普通角色扩大权限，也不改历史迁移校验和。
CREATE TABLE sys_security_guard (
  id INT NOT NULL COMMENT '固定守卫行编号；1 表示验证码及登录固定窗口的短事务配额锁',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='跨实例验证码容量与失败窗口原子操作守卫';
INSERT INTO sys_security_guard(id) VALUES(1);

CREATE TABLE sys_security_state (
  token_key CHAR(64) NOT NULL COMMENT '256 位随机令牌的 SHA-256 摘要；数据库和日志不保存原始令牌',
  kind VARCHAR(16) NOT NULL COMMENT '一次性状态类型：CHALLENGE 拼图答案、PROOF 验证通过凭证',
  subject_key CHAR(64) NOT NULL COMMENT '账号与来源绑定组合的摘要；同组合换题原子废弃旧题',
  payload TEXT NOT NULL COMMENT '仅服务端读取的绑定上下文及随机答案；不通过公开接口返回',
  expires_at BIGINT NOT NULL COMMENT '数据库时间计算的过期毫秒时间戳；所有实例统一校验',
  PRIMARY KEY(token_key),
  KEY idx_security_state_subject(kind,subject_key),
  KEY idx_security_state_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='跨实例一次性验证码与通过凭证；删除先独立提交，失败不可重放';

CREATE TABLE sys_security_rate (
  rate_key CHAR(64) NOT NULL COMMENT '限流目的与来源或账号组合的 SHA-256 摘要，避免明文来源标识入库',
  attempts INT NOT NULL COMMENT '固定窗口累计次数；数据库原子递增，应用重启不清零',
  expires_at BIGINT NOT NULL COMMENT '固定窗口结束的数据库毫秒时间戳；后续失败不滑动延长窗口',
  PRIMARY KEY(rate_key),
  KEY idx_security_rate_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='验证码生成及密码失败限流的共享固定窗口';

CREATE TABLE sys_durable_task (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT '内部持久队列主键；不是用户访问授权凭据',
  task_type VARCHAR(64) NOT NULL COMMENT '注册处理器的稳定类型编码，不接受脚本、类名或任意执行地址',
  business_key VARCHAR(128) NOT NULL COMMENT '同类型下唯一业务幂等键；重启与自动重试保留原键',
  payload TEXT NOT NULL COMMENT '注册业务最小执行参数；导出只存作业编号，不存密码或文件正文',
  status VARCHAR(16) NOT NULL COMMENT 'QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED；仅服务端状态机修改',
  attempts INT NOT NULL DEFAULT 0 COMMENT '本轮实际领取次数；崩溃后重领也计入重试上限',
  max_attempts INT NOT NULL COMMENT '允许的最大尝试次数，1 到 10 次；超过后明确失败',
  next_attempt_at BIGINT NOT NULL COMMENT '下一次允许领取的数据库毫秒时间戳，失败采用有界退避',
  lease_owner CHAR(36) DEFAULT NULL COMMENT '当前进程启动时随机生成的实例编号，仅用于诊断',
  lease_token CHAR(36) DEFAULT NULL COMMENT '每次领取的随机隔离令牌；到期、取消或重领后旧工作器不可写入',
  lease_until BIGINT DEFAULT NULL COMMENT '租约结束的数据库毫秒时间戳；只有仍有效的原租约可续期',
  heartbeat_at BIGINT DEFAULT NULL COMMENT '最近成功续期的数据库毫秒时间戳',
  last_error VARCHAR(300) DEFAULT NULL COMMENT '脱敏后的失败说明；不保存网络凭证、SQL 或客户正文',
  created_at BIGINT NOT NULL COMMENT '首次入队的数据库毫秒时间戳，重试不改变',
  updated_at BIGINT NOT NULL COMMENT '最近状态或心跳变化的数据库毫秒时间戳',
  PRIMARY KEY(id),
  UNIQUE KEY uk_durable_task_business(task_type,business_key),
  KEY idx_durable_task_ready(task_type,status,next_attempt_at,lease_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='支持跨实例持久领取、租约心跳、故障恢复与幂等业务提交的队列';

CREATE TABLE sys_bulk_result (
  job_id BIGINT NOT NULL COMMENT '批量导出作业编号，一份作业只有一份已提交成功正文',
  content LONGBLOB NOT NULL COMMENT '完成的 UTF-8 CSV 正文；受作业本人归属、实时权限指纹和到期校验保护',
  created_at BIGINT NOT NULL COMMENT '成功结果提交的数据库毫秒时间戳，与成功状态同事务写入',
  PRIMARY KEY(job_id),
  CONSTRAINT fk_bulk_result_job FOREIGN KEY(job_id) REFERENCES sys_bulk_job(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='跨实例共享导出成功正文；局部临时文件不是成功结果的唯一副本';

ALTER TABLE ops_job_execution
  ADD COLUMN task_key VARCHAR(128) DEFAULT NULL COMMENT '持久执行的稳定业务幂等键；故障恢复更新同一日志，旧日志保持为空',
  ADD COLUMN attempts INT NOT NULL DEFAULT 0 COMMENT '本轮领取尝试次数，包括进程故障后的重领',
  ADD UNIQUE KEY uk_job_execution_task(task_key);
