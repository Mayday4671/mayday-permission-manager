package com.mayday.operations.storage;

import java.util.UUID;

/** 对象键统一生成和校验；拒绝斜线逃逸、相对路径、控制字符以及用户提交的原始文件名。 */
public final class StorageKeys {
  private StorageKeys() {}

  /** 生成与原始文件名和业务目录无关的随机对象键，前两位分片避免本地目录文件过密。 */
  public static String create() {
    String identifier = UUID.randomUUID().toString();
    return identifier.substring(0, 2) + "/" + identifier;
  }

  /** 限定分片加 UUID 及可选缩略图后缀，拒绝绝对路径、路径穿越和任意客户端对象键。 */
  public static String validate(String key) {
    if (key == null || !key.matches("[0-9a-f]{2}/[0-9a-f-]{36}(?:\\.thumb\\.png)?"))
      throw new IllegalArgumentException("文件存储键无效");
    return key;
  }
}
