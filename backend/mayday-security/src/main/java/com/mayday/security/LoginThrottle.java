package com.mayday.security;

import java.util.Locale;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** MySQL 共享的登录失败限流；所有实例读取同一固定窗口，重启或切换节点不会重置失败记录。 */
@Component
public class LoginThrottle {
  private final SecurityState state;

  /** 生产只装配共享实现；账号大小写与既有登录规范一致，来源取实际连接地址而非伪造代理头。 */
  @Autowired
  public LoginThrottle(JdbcSecurityState state) {
    this.state = state;
  }

  /** 单元测试可注入受控状态，不提供运行时内存回退开关。 */
  LoginThrottle(SecurityState state) {
    this.state = state;
  }

  private String account(String ip, String username) {
    return ip + "\n" + username.toLowerCase(Locale.ROOT);
  }

  /** 每次登录前检查来源与账号窗口；容量达到上限时拒绝新请求。 */
  public boolean allowed(String ip, String username) {
    return state.allowed(ip, account(ip, username));
  }

  /** 失败窗口原子递增，成功登录不消耗失败预算；并发正在校验的请求仍可能先于失败提交通过检查。 */
  public void failed(String ip, String username) {
    state.failed(ip, account(ip, username));
  }

  /** 只清除当前账号来源组合，保留出口地址总失败计数，防止成功账号掩护批量猜测。 */
  public void succeeded(String ip, String username) {
    state.succeeded(account(ip, username));
  }
}
