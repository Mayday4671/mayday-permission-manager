package com.mayday.identity;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/** AES-GCM 加密可逆身份材料；密钥由部署秘密单独提供，数据库备份本身不能解密 TOTP/PKCE。 */
@Component
public class IdentitySecrets {
  private final IdentityProperties properties;
  private final SecureRandom random = new SecureRandom();

  public IdentitySecrets(IdentityProperties properties) {
    this.properties = properties;
  }

  /** 加密密钥必须是 Base64 编码的 32 字节独立随机值；错误仅指出配置名称，不输出内容。 */
  public static void validateKey(String value) {
    try {
      if (Base64.getDecoder().decode(value).length != 32) throw new IllegalArgumentException();
    } catch (IllegalArgumentException invalid) {
      throw new IllegalStateException("MAYDAY_IDENTITY_ENCRYPTION_KEY 必须配置 32 字节随机密钥的 Base64 编码");
    }
  }

  /** 每个密文使用独立 96 位 IV 和 128 位认证标签；用途绑定防止不同类型密文互换。 */
  public String encrypt(String value, String purpose) {
    byte[] iv = new byte[12];
    random.nextBytes(iv);
    try {
      Cipher cipher = cipher(Cipher.ENCRYPT_MODE, iv, purpose);
      return Base64.getEncoder().encodeToString(iv)
          + "."
          + Base64.getEncoder()
              .encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException failure) {
      throw new IllegalStateException("身份材料加密失败");
    }
  }

  /** 用途、密钥或认证标签不匹配时拒绝解密，不能退回读取明文或空密码路径。 */
  public String decrypt(String value, String purpose) {
    try {
      String[] parts = value.split("\\.", -1);
      if (parts.length != 2) throw new IllegalArgumentException();
      byte[] iv = Base64.getDecoder().decode(parts[0]);
      if (iv.length != 12) throw new IllegalArgumentException();
      return new String(
          cipher(Cipher.DECRYPT_MODE, iv, purpose).doFinal(Base64.getDecoder().decode(parts[1])),
          StandardCharsets.UTF_8);
    } catch (GeneralSecurityException | IllegalArgumentException failure) {
      throw new IllegalStateException("身份材料无法解密，请检查部署密钥");
    }
  }

  private Cipher cipher(int mode, byte[] iv, String purpose) throws GeneralSecurityException {
    validateKey(properties.getEncryptionKey());
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
        mode,
        new SecretKeySpec(Base64.getDecoder().decode(properties.getEncryptionKey()), "AES"),
        new GCMParameterSpec(128, iv));
    cipher.updateAAD(purpose.getBytes(StandardCharsets.UTF_8));
    return cipher;
  }
}
