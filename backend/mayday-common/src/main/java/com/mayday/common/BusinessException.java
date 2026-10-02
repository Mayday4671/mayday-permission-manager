package com.mayday.common;

/** 可向用户直接展示的业务错误；禁止把数据库异常、堆栈或密码放入 message。 */
public class BusinessException extends RuntimeException {
  /** 接收已脱敏、可向当前用户展示的校验或状态错误，由统一异常处理转换为失败响应。 */
  public BusinessException(String message) {
    super(message);
  }
}
