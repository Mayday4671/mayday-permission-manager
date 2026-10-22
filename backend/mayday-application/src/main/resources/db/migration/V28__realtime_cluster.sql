-- E5 在线刷新仅传资源名；业务正文和权限仍由原受保护接口读取，不把令牌写进总线。
CREATE TABLE sys_realtime_guard (
  id INT NOT NULL COMMENT '固定值 1；刷新日志分配编号与业务提交的顺序守卫',
  PRIMARY KEY(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='刷新提交顺序守卫，防止消费者跳过迟提交的低编号事件';
INSERT INTO sys_realtime_guard(id) VALUES(1);

CREATE TABLE sys_realtime_event (
  id BIGINT NOT NULL AUTO_INCREMENT COMMENT '递增刷新事件编号；每个应用实例独立维护消费游标',
  recipient_id BIGINT NOT NULL COMMENT '业务提交结果确定的接收账号编号；发送前仍重新检查当前会话权限',
  topics VARCHAR(64) NOT NULL COMMENT '逗号分隔的白名单资源名 messages/requests，不存业务正文和联系方式',
  created_at DATETIME(3) NOT NULL COMMENT '业务事务写入提示的数据库时间；回滚业务不会留下提示',
  PRIMARY KEY(id),
  KEY idx_realtime_event_created(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='跨实例已提交刷新提示日志；一天前提示可清理，业务消息独立保留';

CREATE TABLE sys_realtime_connection (
  id CHAR(36) NOT NULL COMMENT '服务端随机连接编号；不包含令牌、客户端地址或个人资料',
  user_id BIGINT NOT NULL COMMENT '已认证账号编号，用于全实例每账号四条连接配额',
  expires_at DATETIME(3) NOT NULL COMMENT '连接保活到期的数据库时间；故障实例不续期，三十秒自然释放',
  PRIMARY KEY(id),
  KEY idx_realtime_connection_user(user_id),
  KEY idx_realtime_connection_expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='跨实例 SSE 连接配额与故障自动释放记录；原始会话令牌仅留在本机连接内存';
