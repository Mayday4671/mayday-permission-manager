package com.mayday.common;

/** 文件删除保护扩展点。各业务报告有效引用，文件模块不反向依赖内容或审批实现。 */
public interface FileUsage {
  boolean referenced(Long fileId);
}
