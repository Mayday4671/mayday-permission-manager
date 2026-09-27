package com.mayday.common;

/** 可向用户直接展示的业务错误；禁止把数据库异常、堆栈或密码放入 message。 */
public class BusinessException extends RuntimeException {
  public BusinessException(String message) {
    super(message);
  }
}
