package com.mayday.agentscope;

import java.util.Base64;

import com.mayday.common.exception.BusinessException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies confidentiality, randomized encryption, and authenticated decryption
 * of model keys.
 */
class AgentScopeSecretCipherTest
{
    private static final String API_KEY = "unit-test-dashscope-key-do-not-use";
    private static final String ENCRYPTION_KEY = Base64.getEncoder().encodeToString(new byte[32]);

    /**
     * Each save creates distinct ciphertext while both values recover the original
     * key.
     */
    @Test
    void encryptsWithRandomIvAndDecryptsTheSecret()
    {
        AgentScopeSecretCipher cipher = new AgentScopeSecretCipher(ENCRYPTION_KEY);

        String first = cipher.encrypt(API_KEY);
        String second = cipher.encrypt(API_KEY);

        assertThat(first).startsWith("v1.").doesNotContain(API_KEY).isNotEqualTo(second);
        assertThat(cipher.decrypt(first)).isEqualTo(API_KEY);
        assertThat(cipher.decrypt(second)).isEqualTo(API_KEY);
    }

    /**
     * Authentication rejects stored ciphertext modified outside the application.
     */
    @Test
    void rejectsTamperedCiphertext()
    {
        AgentScopeSecretCipher cipher = new AgentScopeSecretCipher(ENCRYPTION_KEY);
        String encrypted = cipher.encrypt(API_KEY);
        String[] parts = encrypted.split("\\.", -1);
        byte[] payload = Base64.getDecoder().decode(parts[2]);
        payload[0] ^= 1;
        String tampered = parts[0] + "." + parts[1] + "." + Base64.getEncoder().encodeToString(payload);

        assertThatThrownBy(() -> cipher.decrypt(tampered)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("MAYDAY_IDENTITY_ENCRYPTION_KEY").hasMessageNotContaining(API_KEY);
    }

    /** Saving a UI-managed secret requires the stable deployment encryption key. */
    @Test
    void refusesToEncryptWithoutDeploymentKey()
    {
        AgentScopeSecretCipher cipher = new AgentScopeSecretCipher("");

        assertThatThrownBy(() -> cipher.encrypt(API_KEY)).isInstanceOf(BusinessException.class)
                .hasMessageContaining("MAYDAY_IDENTITY_ENCRYPTION_KEY").hasMessageNotContaining(API_KEY);
    }
}
