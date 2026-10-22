package com.mayday.telegram;

import it.tdlight.jni.TdApi;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

/**
 * Verifies the deployment proxy settings map to the pinned TDLib API variants.
 */
class TdLightTelegramProxyTest
{
    /**
     * Maps SOCKS5 host, port, and optional authentication without changing them.
     */
    @Test
    void shouldCreateSocks5Proxy()
    {
        TelegramSettings settings = proxySettings("socks5");
        settings.setProxyUsername("operator");
        settings.setProxyPassword("private-password");

        TdApi.Proxy proxy = TdLightTelegramSessionClientProvider.configuredProxy(settings);

        assertEquals("proxy.example.net", proxy.server);
        assertEquals(1080, proxy.port);
        TdApi.ProxyTypeSocks5 type = assertInstanceOf(TdApi.ProxyTypeSocks5.class, proxy.type);
        assertEquals("operator", type.username);
        assertEquals("private-password", type.password);
    }

    /**
     * Uses HTTP CONNECT rather than claiming HTTP-only proxy support.
     */
    @Test
    void shouldCreateTransparentHttpProxy()
    {
        TelegramSettings settings = proxySettings("http");

        TdApi.Proxy proxy = TdLightTelegramSessionClientProvider.configuredProxy(settings);

        TdApi.ProxyTypeHttp type = assertInstanceOf(TdApi.ProxyTypeHttp.class, proxy.type);
        assertFalse(type.httpOnly);
    }

    /**
     * Maps the deployment MTProto secret only to the native request object.
     */
    @Test
    void shouldCreateMtprotoProxy()
    {
        TelegramSettings settings = proxySettings("mtproto");
        settings.setProxySecret("0123456789abcdef");

        TdApi.Proxy proxy = TdLightTelegramSessionClientProvider.configuredProxy(settings);

        TdApi.ProxyTypeMtproto type = assertInstanceOf(TdApi.ProxyTypeMtproto.class, proxy.type);
        assertEquals("0123456789abcdef", type.secret);
    }

    private TelegramSettings proxySettings(String type)
    {
        TelegramSettings settings = new TelegramSettings();
        settings.setProxyEnabled(true);
        settings.setProxyType(type);
        settings.setProxyHost("proxy.example.net");
        settings.setProxyPort(1080);
        return settings;
    }
}
