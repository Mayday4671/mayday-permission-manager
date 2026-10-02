package com.mayday.common;

/** 记录已删除或主键不存在；独立于表单校验错误，HTTP 边界应返回 404。 */
public class ResourceNotFoundException extends RuntimeException {
  public ResourceNotFoundException(String message) {
    super(message);
  }
}
