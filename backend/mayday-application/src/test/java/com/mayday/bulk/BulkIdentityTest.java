package com.mayday.bulk;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

import com.mayday.security.AccessPolicy;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** 文件幂等信息包含凭据时不能保留快速密码猜测校验；测试使用低成本 BCrypt 控制单元耗时。 */
class BulkIdentityTest {
  @Test
  void fileFingerprintIsSaltedSlowHashAndStillMatchesExactRetries() {
    BulkIdentity identity =
        new BulkIdentity(mock(AccessPolicy.class), new BCryptPasswordEncoder(4));
    byte[] original = "username,password\nalice,Original123!".getBytes(StandardCharsets.UTF_8);
    String first = identity.encodeInput(original);
    String second = identity.encodeInput(original);
    assertNotEquals(first, second);
    assertTrue(first.startsWith("$2"));
    assertTrue(first.length() <= 64);
    assertNotEquals(BulkIdentity.digest(original), first);
    assertTrue(identity.matchesInput(original, first));
    assertFalse(
        identity.matchesInput(
            "username,password\nalice,Different123!".getBytes(StandardCharsets.UTF_8), first));
  }
}
