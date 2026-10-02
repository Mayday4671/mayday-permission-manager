package com.mayday.common;

/** 记录已删除或主键不存在；独立于表单校验错误，HTTP 边界应返回 404。 */
public class ResourceNotFoundException extends RuntimeException {
  /** 表达已经按身份和资源类型查找后仍不存在的记录，避免把不存在误报为可重试的表单错误。 */
  public ResourceNotFoundException(String message) {
    super(message);
  }
}
