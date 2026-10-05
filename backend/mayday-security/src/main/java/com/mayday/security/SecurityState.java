package com.mayday.security;

/** 登录防滥用的原子共享状态契约；生产实现使用数据库，测试可以注入受控时钟的内存实现。 */
interface SecurityState {
  /** 先领取来源生成配额，超过配额的请求不进入昂贵的栅格绘图；不持锁绘图。 */
  void reserveChallenge(String source);

  /** 挑战生成与来源配额一起提交，同账号同来源的新题原子废弃旧题。 */
  void challenge(String token, String subject, String source, String payload, long ttl);

  /** 通过凭证必须先持久化后才返回，原始令牌不会保存在数据库或日志中。 */
  void proof(String token, String subject, String payload, long ttl);

  /** 先独立提交删除再返回正文；后续校验失败或外层事务回滚都不能恢复一次性凭证。 */
  String take(String kind, String token);

  /** 同来源和账号的失败窗口共享，正常成功仅清除账号窗口，不清除来源失败历史。 */
  boolean allowed(String source, String account);

  /** 两个失败窗口在同一个数据库事务递增，节点重启不重置失败次数。 */
  void failed(String source, String account);

  /** 成功仅清除该账号来源组合，不能借成功登录清除其他账号的限流。 */
  void succeeded(String account);

  /** 使用共享存储的统一时间，避免两台应用时钟偏差扩大令牌有效期。 */
  long now();
}
