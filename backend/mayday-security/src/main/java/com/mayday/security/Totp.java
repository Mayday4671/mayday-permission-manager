package com.mayday.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** RFC 6238 的 SHA-1/30秒/6位 TOTP；只负责算法，防重放/限流/密钥保存交给持久服务。 */
public final class Totp {
  private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  private Totp() {}

  /** 生成 160 位共享秘密，使用认证器通用的无填充 Base32，不能写入日志。 */
  public static String newSecret() {
    byte[] value = new byte[20];
    new SecureRandom().nextBytes(value);
    StringBuilder result = new StringBuilder();
    int buffer = 0, bits = 0;
    for (byte item : value) {
      buffer = (buffer << 8) | (item & 255);
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        result.append(ALPHABET.charAt((buffer >> bits) & 31));
      }
    }
    if (bits > 0) result.append(ALPHABET.charAt((buffer << (5 - bits)) & 31));
    return result.toString();
  }

  /** 限定当前及相邻时间窗；返回匹配计数供数据库原子拒绝重放，失败返回 -1。 */
  public static long verify(String secret, String value, Instant now, long lastAcceptedStep) {
    if (value == null || !value.matches("\\d{6}")) return -1;
    long current = now.getEpochSecond() / 30;
    for (long step = current - 1; step <= current + 1; step++) {
      if (step > lastAcceptedStep
          && MessageDigest.isEqual(
              code(secret, step, 6).getBytes(StandardCharsets.US_ASCII),
              value.getBytes(StandardCharsets.US_ASCII))) return step;
    }
    return -1;
  }

  /** 标准动态截断生成指定长度验证码；公开供协议向量测试，不包含存储或授权副作用。 */
  public static String code(String secret, long step, int digits) {
    if (digits != 6 && digits != 8) throw new IllegalArgumentException("仅支持 6/8 位 TOTP");
    try {
      Mac mac = Mac.getInstance("HmacSHA1");
      mac.init(new SecretKeySpec(decode(secret), "HmacSHA1"));
      byte[] digest = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
      int offset = digest[digest.length - 1] & 15;
      int binary =
          ((digest[offset] & 127) << 24)
              | ((digest[offset + 1] & 255) << 16)
              | ((digest[offset + 2] & 255) << 8)
              | (digest[offset + 3] & 255);
      return String.format(
          Locale.ROOT, "%0" + digits + "d", binary % (digits == 6 ? 1000000 : 100000000));
    } catch (GeneralSecurityException failure) {
      throw new IllegalStateException("TOTP 算法不可用");
    }
  }

  private static byte[] decode(String value) {
    if (value == null || !value.matches("[A-Z2-7]{16,128}"))
      throw new IllegalArgumentException("Base32 格式不正确");
    java.io.ByteArrayOutputStream result = new java.io.ByteArrayOutputStream();
    int buffer = 0, bits = 0;
    for (char item : value.toCharArray()) {
      buffer = (buffer << 5) | ALPHABET.indexOf(item);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        result.write((buffer >> bits) & 255);
      }
    }
    return result.toByteArray();
  }
}
