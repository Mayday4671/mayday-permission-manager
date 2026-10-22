package com.mayday.identity;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import com.mayday.identity.IdentityStore.Challenge;
import com.mayday.identity.mapper.IdentityChallengeMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/** 验证身份挑战的固定到期窗口，防止合法的一次性认证凭证在创建时即过期。 */
class IdentityStoreTest
{
    private static final Instant NOW = Instant.parse("2026-10-22T00:00:00Z");

    @Test
    void createPersistsChallengeWithFiveMinuteLifetime()
    {
        IdentityChallengeMapper mapper = mock(IdentityChallengeMapper.class);
        IdentityStore store = new IdentityStore(mapper, Clock.fixed(NOW, ZoneOffset.UTC),
                mock(PlatformTransactionManager.class));

        String token = store.create("MFA_LOGIN", 42L, "127.0.0.1", null, null, "credential", "revision", null);

        ArgumentCaptor<Challenge> challenge = ArgumentCaptor.forClass(Challenge.class);
        verify(mapper).purgeExpired(eq(NOW.minusSeconds(86400)));
        verify(mapper).insert(challenge.capture(), eq(NOW));
        assertEquals(43, token.length());
        assertEquals(NOW.plusSeconds(300), challenge.getValue().expiresAt());
        verifyNoMoreInteractions(mapper);
    }
}
