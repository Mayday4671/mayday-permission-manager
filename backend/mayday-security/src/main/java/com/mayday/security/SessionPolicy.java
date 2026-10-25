package com.mayday.security;

import java.time.Clock;
import java.time.Instant;
import java.util.Set;

import com.mayday.common.exception.BusinessException;
import com.mayday.system.mapper.EntryMapper;
import com.mayday.system.model.LoginSession;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * 服务端会话策略优先读取系统参数，启动配置仅用于缺失或损坏配置时的回退。 每次认证、签发和会话列表各读取一次完整快照，避免跨节点缓存和同次请求混用新旧参数。
 */
@Component
@ConfigurationProperties(prefix = "mayday.security.sessions")
@RequiredArgsConstructor
public class SessionPolicy implements InitializingBean
{
    public static final String SETTING_KEY = "security.sessionPolicy";
    private static final Set<String> FIELDS = Set.of("absoluteMinutes", "idleMinutes", "maxPerUser");
    private final EntryMapper entries;
    private final JsonMapper json;

    private int absoluteMinutes = 720;
    private int idleMinutes = 30;
    private int maxPerUser = 5;

    /** 固定登录期限，单位分钟；不会因为持续请求而续期。 */
    public int getAbsoluteMinutes()
    {
        return absoluteMinutes;
    }

    /** 绑定启动配置；参数范围与跨字段约束统一在绑定完成后检查。 */
    public void setAbsoluteMinutes(int value)
    {
        absoluteMinutes = value;
    }

    /** 无认证请求的最大间隔，单位分钟；失效判断在服务端完成。 */
    public int getIdleMinutes()
    {
        return idleMinutes;
    }

    /** 绑定无请求期限，不能以零或负数关闭服务端超时保护。 */
    public void setIdleMinutes(int value)
    {
        idleMinutes = value;
    }

    /** 每账号有效登录上限，超出时撤销最早登录，最新登录正常签发。 */
    public int getMaxPerUser()
    {
        return maxPerUser;
    }

    /** 绑定并发上限；不提供无限会话配置，避免账号及在线列表无限增长。 */
    public void setMaxPerUser(int value)
    {
        maxPerUser = value;
    }

    /** 错误配置直接拒绝启动，不静默退回更宽松的安全规则。 */
    @Override
    public void afterPropertiesSet()
    {
        if (absoluteMinutes < 5 || absoluteMinutes > 10080 || idleMinutes < 1 || idleMinutes > absoluteMinutes
                || maxPerUser < 1 || maxPerUser > 20)
        {
            throw new IllegalArgumentException("会话配置无效：固定期限5–10080分钟，无请求期限1–固定期限，并发上限1–20");
        }
    }

    /** 读取数据库中的原子策略；非法历史数据回退启动配置，不关闭超时保护。 */
    public Limits current()
    {
        var entry = entries.findByKindAndCode("settings", SETTING_KEY).orElse(null);
        if (entry != null && entry.isEnabled() && "JSON".equals(entry.getValueType()))
        {
            try
            {
                return parse(json, entry.getValue());
            } catch (BusinessException ignored)
            {
                // 损坏的配置不能导致所有登录不可用，也不能被解释为无限期登录。
            }
        }
        return new Limits(absoluteMinutes, idleMinutes, maxPerUser);
    }

    /** 页面和通用参数接口共用严格校验，拒绝小数、字符串数字、未知字段和不完整策略。 */
    public static Limits parse(JsonMapper json, String value)
    {
        try
        {
            var node = json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(value);
            if (node == null || !node.isObject() || node.size() != FIELDS.size())
            {
                throw new IllegalArgumentException();
            }
            for (String field : FIELDS)
            {
                var number = node.get(field);
                if (number == null || !number.isIntegralNumber() || !number.canConvertToInt())
                {
                    throw new IllegalArgumentException();
                }
            }
            var limits = new Limits(node.get("absoluteMinutes").intValue(), node.get("idleMinutes").intValue(),
                    node.get("maxPerUser").intValue());
            if (limits.absoluteMinutes() < 5 || limits.absoluteMinutes() > 10080 || limits.idleMinutes() < 1
                    || limits.idleMinutes() > limits.absoluteMinutes() || limits.maxPerUser() < 1
                    || limits.maxPerUser() > 20)
            {
                throw new IllegalArgumentException();
            }
            return limits;
        } catch (RuntimeException error)
        {
            throw new BusinessException("登录有效期须为 5–10080 分钟，空闲超时须为 1–登录有效期分钟，同时登录上限须为 1–20，均为整数");
        }
    }

    /** 认证、签发和列表共用可测试的 UTC 时钟，不依赖部署机器的显示时区。 */
    @Bean
    Clock sessionClock()
    {
        return Clock.systemUTC();
    }

    /** 缺少可信签发/活动时间的旧记录拒绝认证，不用当前时间将未知记录重新激活。 */
    public boolean active(LoginSession session, Instant now)
    {
        return current().active(session, now);
    }

    /** 统一认证与列表的失效时间；返回三种期限的最早值，null 表示记录无法安全恢复。 */
    public Instant effectiveExpiry(LoginSession session)
    {
        return current().effectiveExpiry(session);
    }

    /** 一次操作使用同一快照；缩短立即约束旧会话，延长不能越过签发时记录的固定到期时间。 */
    public record Limits(int absoluteMinutes, int idleMinutes, int maxPerUser) {
        /** 固定期限与无认证请求期限取最早值，不将后台轮询误称为键鼠活动。 */
        public boolean active(LoginSession session, Instant now)
        {
            Instant expiry = effectiveExpiry(session);
            return expiry != null && expiry.isAfter(now);
        }

        /** 缺少可信创建或到期时间的历史记录不能通过调整参数恢复认证。 */
        public Instant effectiveExpiry(LoginSession session)
        {
            if (session.getCreatedAt() == null || session.getExpiresAt() == null)
            {
                return null;
            }
            Instant activity = session.getLastActiveAt() == null ? session.getCreatedAt() : session.getLastActiveAt();
            Instant absolute = session.getCreatedAt().plusSeconds(absoluteMinutes * 60L);
            Instant idle = activity.plusSeconds(idleMinutes * 60L);
            Instant expiry = session.getExpiresAt().isBefore(absolute) ? session.getExpiresAt() : absolute;
            return idle.isBefore(expiry) ? idle : expiry;
        }
    }
}
