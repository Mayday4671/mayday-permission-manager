package com.mayday;

import java.util.List;
import java.util.Optional;

import com.mayday.common.exception.BusinessException;
import com.mayday.identity.MfaService;
import com.mayday.security.AccessPolicy;
import com.mayday.security.LoginThrottle;
import com.mayday.security.SlideCaptchaService;
import com.mayday.security.TokenService;
import com.mayday.service.PortalThemePolicy;
import com.mayday.service.SettingService;
import com.mayday.system.mapper.EntryMapper;
import com.mayday.system.mapper.UserMapper;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.web.AuthController;
import com.mayday.web.Contracts;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies dynamic login policy without weakening password, throttle or MFA
 * checks.
 */
class LoginCaptchaPolicyTest
{
    @Test
    void onlyAnEnabledExplicitFalseDisablesVerificationAndReadsAreNotCached()
    {
        EntryMapper entries = mock(EntryMapper.class);
        SettingService settings = new SettingService(entries, JsonMapper.builder().build(),
                mock(PortalThemePolicy.class));
        SystemEntry flag = new SystemEntry();
        flag.setCode(SettingService.LOGIN_CAPTCHA_KEY);
        flag.setValue("false");
        flag.setEnabled(true);
        when(entries.findByKindOrderBySortOrderAscIdAsc("settings")).thenReturn(List.of());
        assertThat(settings.loginCaptchaEnabled()).isTrue();
        when(entries.findByKindOrderBySortOrderAscIdAsc("settings")).thenReturn(List.of(flag));
        assertThat(settings.loginCaptchaEnabled()).isTrue();
        flag.setValueType("BOOLEAN");
        assertThat(settings.loginCaptchaEnabled()).isFalse();
        flag.setValue("true");
        assertThat(settings.loginCaptchaEnabled()).isTrue();
        flag.setValue("invalid");
        assertThat(settings.loginCaptchaEnabled()).isTrue();
        flag.setValue("false");
        flag.setEnabled(false);
        assertThat(settings.loginCaptchaEnabled()).isTrue();
        assertThat(settings.publicValues()).doesNotContainKey(SettingService.LOGIN_CAPTCHA_KEY);
        assertThatThrownBy(() -> settings.validate(SettingService.LOGIN_CAPTCHA_KEY, "false", "TEXT"))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void enabledPolicyRejectsMissingProofBeforePasswordComparison()
    {
        UserMapper users = mock(UserMapper.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        LoginThrottle throttle = mock(LoginThrottle.class);
        SlideCaptchaService captcha = mock(SlideCaptchaService.class);
        SettingService settings = mock(SettingService.class);
        when(settings.loginCaptchaEnabled()).thenReturn(true);
        when(throttle.allowed(anyString(), anyString())).thenReturn(true);
        doThrow(new BusinessException("请先完成滑动验证")).when(captcha).consume(isNull(), anyString(), anyString());
        AuthController controller = new AuthController(users, encoder, mock(TokenService.class),
                mock(AccessPolicy.class), throttle, captcha, mock(EntryMapper.class), mock(MfaService.class), settings);
        assertThatThrownBy(() -> controller.login(new Contracts.LoginRequest("member", "password", null),
                new MockHttpServletRequest())).isInstanceOf(BusinessException.class).hasMessageContaining("滑动验证");
        verify(users, never()).findByUsername(anyString());
    }

    @Test
    void disablingCaptchaStillVerifiesPasswordAndCallsMfaAndReenablingTakesEffectImmediately()
    {
        UserMapper users = mock(UserMapper.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        LoginThrottle throttle = mock(LoginThrottle.class);
        SlideCaptchaService captcha = mock(SlideCaptchaService.class);
        SettingService settings = mock(SettingService.class);
        MfaService mfa = mock(MfaService.class);
        when(throttle.allowed(anyString(), anyString())).thenReturn(true);
        SysUser user = new SysUser();
        user.setUsername("member");
        user.setEnabled(true);
        user.setPasswordHash("hash");
        when(users.findByUsername("member")).thenReturn(Optional.of(user));
        when(encoder.matches("password", "hash")).thenReturn(true);
        when(mfa.loginAfterPrimary(any(), anyString(), isNull()))
                .thenReturn(new Contracts.LoginView(null, true, "challenge"));
        AuthController controller = new AuthController(users, encoder, mock(TokenService.class),
                mock(AccessPolicy.class), throttle, captcha, mock(EntryMapper.class), mfa, settings);
        assertThat(
                controller.login(new Contracts.LoginRequest("member", "password", null), new MockHttpServletRequest())
                        .getStatusCode().value())
                .isEqualTo(200);
        verify(captcha, never()).consume(any(), anyString(), anyString());
        verify(mfa).loginAfterPrimary(any(), anyString(), isNull());
        assertThat(controller.login(new Contracts.LoginRequest("member", "wrong", null), new MockHttpServletRequest())
                .getStatusCode().value()).isEqualTo(401);
        verify(throttle).failed(anyString(), anyString());
        when(settings.loginCaptchaEnabled()).thenReturn(true);
        doThrow(new BusinessException("请先完成滑动验证")).when(captcha).consume(isNull(), anyString(), anyString());
        assertThatThrownBy(() -> controller.login(new Contracts.LoginRequest("member", "password", null),
                new MockHttpServletRequest())).isInstanceOf(BusinessException.class);
    }
}
