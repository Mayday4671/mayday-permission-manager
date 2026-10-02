package com.mayday.common;

/** 文件删除保护扩展点。各业务报告有效引用，文件模块不反向依赖内容或审批实现。 */
public interface FileUsage {
  /** 返回业务是否仍持有有效引用；此查询不授予读取文件权限，失败时调用方不得继续永久删除。 */
  boolean referenced(Long fileId);
}
