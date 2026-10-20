package com.mayday.agentscope;

import com.mayday.common.exception.BusinessException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Encrypts the DashScope API key at rest with the deployment-owned identity encryption key.
 *
 * <p>Each value receives a random 96-bit IV and a 128-bit GCM authentication tag. Fixed associated
 * data binds the ciphertext to this setting so it cannot be moved to another encrypted-secret
 * field.
 */
@Component
public class AgentScopeSecretCipher {
  private static final byte[] ASSOCIATED_DATA =
      "mayday:agentscope:dashscope-api-key:v1".getBytes(StandardCharsets.UTF_8);
  private static final int IV_LENGTH = 12;
  private static final int TAG_LENGTH_BITS = 128;

  private final String encryptionKey;
  private final SecureRandom random = new SecureRandom();

  /** Uses the same stable deployment key as MFA/OIDC secret encryption. */
  public AgentScopeSecretCipher(@Value("${mayday.identity.encryption-key:}") String encryptionKey) {
    this.encryptionKey = encryptionKey;
  }

  private static Cipher cipher(int mode, byte[] iv, byte[] key) throws GeneralSecurityException {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_LENGTH_BITS, iv));
    cipher.updateAAD(ASSOCIATED_DATA);
    return cipher;
  }

  /** Encrypts a secret without returning cryptographic failure details to callers. */
  public String encrypt(String secret) {
    byte[] key = decodeKeyForWrite();
    byte[] iv = new byte[IV_LENGTH];
    random.nextBytes(iv);
    try {
      Cipher cipher = cipher(Cipher.ENCRYPT_MODE, iv, key);
      byte[] encrypted = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
      return "v1."
          + Base64.getEncoder().encodeToString(iv)
          + "."
          + Base64.getEncoder().encodeToString(encrypted);
    } catch (GeneralSecurityException failure) {
      throw new IllegalStateException("智能体密钥加密失败");
    }
  }

  /** Decrypts only ciphertext written by this setting and refuses unauthenticated data. */
  public String decrypt(String encryptedValue) {
    try {
      String[] parts = encryptedValue.split("\\.", -1);
      if (parts.length != 3 || !"v1".equals(parts[0])) {
        throw new IllegalArgumentException();
      }
      byte[] iv = Base64.getDecoder().decode(parts[1]);
      if (iv.length != IV_LENGTH) {
        throw new IllegalArgumentException();
      }
      byte[] key = decodeKeyForRead();
      byte[] plaintext =
          cipher(Cipher.DECRYPT_MODE, iv, key).doFinal(Base64.getDecoder().decode(parts[2]));
      return new String(plaintext, StandardCharsets.UTF_8);
    } catch (GeneralSecurityException | IllegalArgumentException failure) {
      throw new IllegalStateException(
          "智能体密钥无法解密，请恢复与数据库匹配的 MAYDAY_IDENTITY_ENCRYPTION_KEY", failure);
    }
  }

  private byte[] decodeKeyForWrite() {
    byte[] key = decodeKeyForRead();
    if (key == null) {
      throw new BusinessException("保存模型密钥前，请由部署人员配置 MAYDAY_IDENTITY_ENCRYPTION_KEY 并重启服务");
    }
    return key;
  }

  private byte[] decodeKeyForRead() {
    try {
      byte[] key = Base64.getDecoder().decode(encryptionKey);
      if (key.length == 32) {
        return key;
      }
    } catch (IllegalArgumentException ignored) {
      // The caller receives a deployment-oriented message without key material or parser details.
    }
    return null;
  }
}
