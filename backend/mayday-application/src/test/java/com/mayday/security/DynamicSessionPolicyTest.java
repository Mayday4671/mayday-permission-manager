package com.mayday.security;

import java.time.Instant;
import java.util.Optional;

import com.mayday.common.exception.BusinessException;
import com.mayday.service.PortalThemePolicy;
import com.mayday.service.SettingService;
import com.mayday.system.mapper.EntryMapper;
import com.mayday.system.model.LoginSession;
import com.mayday.system.model.SystemEntry;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 验证系统参数即时生效、原子校验、异常回退及已签发会话的固定截止时间。 */
class DynamicSessionPolicyTest
{
    private final EntryMapper entries = mock(EntryMapper.class);
    private final JsonMapper json = JsonMapper.builder().build();
    private final SessionPolicy policy = new SessionPolicy(entries, json);

    @Test
    void databaseChangesAreVisibleWithoutRestartAndInvalidDataUsesFallback()
    {
        assertEquals(new SessionPolicy.Limits(720, 30, 5), policy.current());
        var entry = new SystemEntry();
        entry.setValueType("JSON");
        entry.setValue("{\"absoluteMinutes\":120,\"idleMinutes\":15,\"maxPerUser\":2}");
        when(entries.findByKindAndCode("settings", SessionPolicy.SETTING_KEY)).thenReturn(Optional.of(entry));
        assertEquals(new SessionPolicy.Limits(120, 15, 2), policy.current());
        entry.setValue("{\"absoluteMinutes\":60,\"idleMinutes\":10,\"maxPerUser\":1}");
        assertEquals(new SessionPolicy.Limits(60, 10, 1), policy.current());
        entry.setValue("{}");
        assertEquals(new SessionPolicy.Limits(720, 30, 5), policy.current());
        entry.setEnabled(false);
        assertEquals(720, policy.current().absoluteMinutes());
    }

    @Test
    void parameterApiRejectsIncompleteOutOfRangeAndCoercedPolicies()
    {
        var settings = new SettingService(entries, json, mock(PortalThemePolicy.class));
        for (String value : new String[]
        {"{}", "null", "[]", "{\"absoluteMinutes\":5,\"idleMinutes\":6,\"maxPerUser\":1}",
                "{\"absoluteMinutes\":720,\"idleMinutes\":0,\"maxPerUser\":1}",
                "{\"absoluteMinutes\":10081,\"idleMinutes\":30,\"maxPerUser\":1}",
                "{\"absoluteMinutes\":720,\"idleMinutes\":30,\"maxPerUser\":21}",
                "{\"absoluteMinutes\":720,\"idleMinutes\":30,\"maxPerUser\":1.5}",
                "{\"absoluteMinutes\":\"720\",\"idleMinutes\":30,\"maxPerUser\":1}",
                "{\"absoluteMinutes\":720,\"idleMinutes\":30,\"maxPerUser\":1,\"extra\":1}",
                "{\"absoluteMinutes\":720,\"idleMinutes\":30,\"maxPerUser\":1} {}"})
        {
            assertThrows(BusinessException.class, () -> settings.validate(SessionPolicy.SETTING_KEY, value, "JSON"));
        }
        assertThrows(BusinessException.class, () -> settings.validate(SessionPolicy.SETTING_KEY, "{}", "TEXT"));
        settings.validate(SessionPolicy.SETTING_KEY, "{\"absoluteMinutes\":5,\"idleMinutes\":5,\"maxPerUser\":20}",
                "JSON");
    }

    @Test
    void shorterPolicyConstrainsExistingSessionButLongerPolicyDoesNotExtendIssuedExpiry()
    {
        Instant now = Instant.parse("2026-10-25T12:00:00Z");
        var session = new LoginSession();
        session.setCreatedAt(now.minusSeconds(3600));
        session.setLastActiveAt(now);
        session.setExpiresAt(now.plusSeconds(3600));
        assertTrue(new SessionPolicy.Limits(120, 30, 5).active(session, now));
        assertFalse(new SessionPolicy.Limits(60, 30, 5).active(session, now));
        assertEquals(session.getExpiresAt(), new SessionPolicy.Limits(720, 120, 5).effectiveExpiry(session));
    }
}
