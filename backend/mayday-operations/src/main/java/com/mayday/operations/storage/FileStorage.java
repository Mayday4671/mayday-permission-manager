package com.mayday.operations.storage;

import java.io.IOException;
import java.io.InputStream;

/** 可迁移的文件存储边界：键由服务器生成，与用户文件名、业务目录和磁盘路径无关。 写入必须完整成功才返回；删除必须幂等，以便数据库提交后的清理可以安全重试。 */
public interface FileStorage {
  /** 稳定的持久化提供方标识，用于读取之前写入的文件，不随新上传部署模式变化。 */
  String provider();

  /** 写入恰好指定字节数后才返回；调用者关闭输入流，并为数据库提交失败登记删除补偿。 */
  void write(String key, InputStream content, long length, String contentType) throws IOException;

  /** 打开已校验对象键的正文流，调用者负责关闭，不在此存储边界授予业务访问权限。 */
  InputStream open(String key) throws IOException;

  /** 幂等删除对象，不存在视为已完成；失败必须抛出异常，交由持久化清理意图重试。 */
  void delete(String key) throws IOException;
}
