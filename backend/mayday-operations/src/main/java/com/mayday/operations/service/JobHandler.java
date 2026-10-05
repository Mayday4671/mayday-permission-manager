package com.mayday.operations.service;

/**
 * 调度扩展契约：实现此接口并注册 Spring Bean，页面只选择 key，不能指定脚本、类名或任意网络地址。 execute
 * 在有超时的业务事务中执行；长时间采集/报表应只提交自己的持久队列并返回任务号。 处理器必须可安全重试、使用幂等业务键；事务外部副作用不能依靠数据库回滚撤销。
 */
public interface JobHandler {
  /** 稳定的处理器编码，启动时拒绝重复编码，历史配置不绑定Java类名。 */
  String key();

  /** 页面业务名称，不显示实现类、脚本路径或连接配置。 */
  String label();

  /** 稳定操作键贯穿崩溃重试；业务扩展用它作为外部请求/业务唯一键，不能用本次随机租约作为幂等键。 */
  record Context(String operationKey, int attempt) {}

  /** 新处理器可以覆盖有上下文的方法；既有短事务处理器继续复用原接口。 */
  default String execute(Context context) {
    return execute();
  }

  /** 执行短维护工作，返回不含凭据或客户隐私的摘要；异常导致业务回滚与独立失败记录。 */
  String execute();
}
