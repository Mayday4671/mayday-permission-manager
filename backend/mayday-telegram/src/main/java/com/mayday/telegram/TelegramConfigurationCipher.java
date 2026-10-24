package com.mayday.telegram;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import com.mayday.common.exception.BusinessException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Encrypts Telegram API/session/proxy secrets with the stable platform identity
 * key.
 *
 * <p>
 * Each stored value receives its own random 96-bit IV and AES-GCM
 * authentication tag. The field-specific associated data prevents ciphertext
 * from being copied between fields.
 */
@Component
public class TelegramConfigurationCipher
{
    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH_BITS = 128;
    private static final String ASSOCIATED_DATA_PREFIX = "mayday:telegram:configuration:v1:";

    private final String encryptionKey;
    private final SecureRandom random = new SecureRandom();

    /**
     * Uses the deployment-owned key already required for encrypted platform
     * secrets.
     */
    public TelegramConfigurationCipher(@Value("${mayday.identity.encryption-key:}") String encryptionKey)
    {
        this.encryptionKey = encryptionKey;
    }

    /**
     * Encrypts one non-empty secret; plaintext and key material are never logged or
     * returned by status APIs.
     */
    public String encrypt(String field, String secret)
    {
        byte[] key = decodeKey();
        byte[] iv = new byte[IV_LENGTH];
        random.nextBytes(iv);
        try
        {
            Cipher cipher = cipher(Cipher.ENCRYPT_MODE, iv, key, associatedData(field));
            byte[] encrypted = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
            return "v1." + Base64.getEncoder().encodeToString(iv) + "." + Base64.getEncoder().encodeToString(encrypted);
        } catch (GeneralSecurityException failure)
        {
            throw new IllegalStateException("Telegram 配置加密失败");
        } finally
        {
            java.util.Arrays.fill(key, (byte) 0);
        }
    }

    /**
     * Decrypts only authenticated Telegram configuration ciphertext created by this
     * component.
     */
    public String decrypt(String field, String encryptedValue)
    {
        byte[] key = decodeKey();
        try
        {
            String[] parts = encryptedValue.split("\\.", -1);
            if (parts.length != 3 || !"v1".equals(parts[0]))
            {
                throw new IllegalArgumentException();
            }
            byte[] iv = Base64.getDecoder().decode(parts[1]);
            if (iv.length != IV_LENGTH)
            {
                throw new IllegalArgumentException();
            }
            byte[] plaintext = cipher(Cipher.DECRYPT_MODE, iv, key, associatedData(field))
                    .doFinal(Base64.getDecoder().decode(parts[2]));
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException failure)
        {
            throw new IllegalStateException("Telegram 配置无法解密，请恢复与数据库匹配的 MAYDAY_IDENTITY_ENCRYPTION_KEY", failure);
        } finally
        {
            java.util.Arrays.fill(key, (byte) 0);
        }
    }

    /**
     * Returns whether the deployment key can safely encrypt settings without
     * exposing it.
     */
    public boolean available()
    {
        try
        {
            byte[] key = Base64.getDecoder().decode(encryptionKey);
            boolean valid = key.length == 32;
            java.util.Arrays.fill(key, (byte) 0);
            return valid;
        } catch (IllegalArgumentException | NullPointerException ignored)
        {
            return false;
        }
    }

    private byte[] decodeKey()
    {
        try
        {
            byte[] key = Base64.getDecoder().decode(encryptionKey);
            if (key.length == 32)
            {
                return key;
            }
        } catch (IllegalArgumentException | NullPointerException ignored)
        {
            // Return one safe deployment error without leaking the key or decoder detail.
        }
        throw new BusinessException("保存 Telegram 配置前，请配置 32 字节 MAYDAY_IDENTITY_ENCRYPTION_KEY 并重启服务");
    }

    private static byte[] associatedData(String field)
    {
        if (field == null || !field.matches("[a-z-]{1,64}"))
        {
            throw new IllegalArgumentException("Invalid Telegram configuration field");
        }
        return (ASSOCIATED_DATA_PREFIX + field).getBytes(StandardCharsets.UTF_8);
    }

    private static Cipher cipher(int mode, byte[] iv, byte[] key, byte[] associatedData) throws GeneralSecurityException
    {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(TAG_LENGTH_BITS, iv));
        cipher.updateAAD(associatedData);
        return cipher;
    }
}
