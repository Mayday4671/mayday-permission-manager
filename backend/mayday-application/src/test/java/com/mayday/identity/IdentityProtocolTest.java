package com.mayday.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mayday.common.BusinessException;
import com.mayday.security.Totp;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.mock.env.MockEnvironment;

/** 协议层使用真实 loopback HTTP 提供商和 RSA ID token；验证不是模拟一个固定 subject 返回值。 */
class IdentityProtocolTest {
  private static final Instant NOW = Instant.parse("2026-10-05T00:00:00Z");
  private final OidcClient client = new OidcClient(Clock.fixed(NOW, ZoneOffset.UTC));

  private IdentityProperties.Provider provider(String issuer) {
    var provider = new IdentityProperties.Provider();
    provider.setId("enterprise");
    provider.setName("企业登录");
    provider.setIssuer(issuer);
    provider.setClientId("client");
    provider.setClientSecret("only-test-secret");
    provider.setAuthorizationUri(issuer + "/authorize");
    provider.setTokenUri(issuer + "/token");
    provider.setJwksUri(issuer + "/jwks");
    provider.setRedirectUri("http://127.0.0.1:15174/auth/oidc/callback");
    return provider;
  }

  private JWTClaimsSet.Builder claims(String issuer) {
    return new JWTClaimsSet.Builder()
        .issuer(issuer)
        .subject("subject-123")
        .audience("client")
        .issueTime(Date.from(NOW))
        .expirationTime(Date.from(NOW.plusSeconds(300)))
        .claim("nonce", "expected-nonce");
  }

  private String signed(RSAKey key, JWTClaimsSet claims) throws Exception {
    SignedJWT token =
        new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(), claims);
    token.sign(new RSASSASigner(key));
    return token.serialize();
  }

  @Test
  void validCodeExchangeUsesRealTokenEndpointPkceBasicAndRotatedKeys() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String issuer = "http://127.0.0.1:" + server.getAddress().getPort();
    RSAKey key = new RSAKeyGenerator(2048).keyID("rotation-new").generate();
    String idToken = signed(key, claims(issuer).build());
    var captured = new AtomicReference<String>();
    server.createContext(
        "/token",
        exchange -> {
          captured.set(
              new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          assertEquals(
              "Basic "
                  + Base64.getEncoder()
                      .encodeToString(
                          "client:only-test-secret".getBytes(StandardCharsets.US_ASCII)),
              exchange.getRequestHeaders().getFirst("Authorization"));
          byte[] body =
              ("{\"id_token\":\"" + idToken + "\",\"access_token\":\"external-token\"}")
                  .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.createContext(
        "/jwks",
        exchange -> {
          byte[] body = new JWKSet(key.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(200, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    try {
      assertEquals(
          "subject-123",
          client.exchange(
              provider(issuer),
              "single-use-code",
              "expected-nonce",
              "43-character-independent-random-code-verifier"));
      assertTrue(
          captured.get().contains("code_verifier=43-character-independent-random-code-verifier"));
      assertTrue(captured.get().contains("grant_type=authorization_code"));
      String url = client.authorization(provider(issuer), "state-value", "nonce-value", "verifier");
      assertTrue(url.contains("code_challenge_method=S256"));
      assertTrue(url.contains("scope=openid"));
      assertTrue(!url.contains("only-test-secret"));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void rejectsIssuerAudienceNonceExpirationAzpAndAttackerSignature() throws Exception {
    RSAKey key = new RSAKeyGenerator(2048).keyID("trusted").generate();
    RSAKey attacker = new RSAKeyGenerator(2048).keyID("trusted").generate();
    var provider = provider("https://issuer.example");
    var keys = new JWKSet(key.toPublicJWK());
    for (JWTClaimsSet.Builder changed :
        List.of(
            claims(provider.getIssuer()).issuer("https://attacker.example"),
            claims(provider.getIssuer()).audience("another-client"),
            claims(provider.getIssuer()).claim("nonce", "wrong"),
            claims(provider.getIssuer()).expirationTime(Date.from(NOW.minusSeconds(31))),
            claims(provider.getIssuer()).audience(List.of("client", "other")).claim("azp", "other"),
            claims(provider.getIssuer()).issueTime(Date.from(NOW.plusSeconds(61))),
            claims(provider.getIssuer()).notBeforeTime(Date.from(NOW.plusSeconds(31))),
            claims(provider.getIssuer()).claim("at_hash", "unrelated-access-token"))) {
      String value = signed(key, changed.build());
      assertThrows(
          BusinessException.class,
          () -> client.verify(provider, value, "expected-nonce", "access-token", keys));
    }
    assertThrows(
        BusinessException.class,
        () ->
            client.verify(
                provider,
                signedUnchecked(attacker, claims(provider.getIssuer()).build()),
                "expected-nonce",
                null,
                keys));
    assertEquals(
        "subject-123",
        client.verify(
            provider,
            signed(key, claims(provider.getIssuer()).build()),
            "expected-nonce",
            null,
            keys));
  }

  private String signedUnchecked(RSAKey key, JWTClaimsSet value) {
    try {
      return signed(key, value);
    } catch (Exception impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  @Test
  void refusesRedirectingTokenEndpointWithoutSendingCodeToSecondAddress() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String issuer = "http://127.0.0.1:" + server.getAddress().getPort();
    var redirected = new java.util.concurrent.atomic.AtomicBoolean(false);
    server.createContext(
        "/token",
        exchange -> {
          exchange.getResponseHeaders().set("Location", issuer + "/capture");
          exchange.sendResponseHeaders(302, -1);
          exchange.close();
        });
    server.createContext(
        "/capture",
        exchange -> {
          redirected.set(true);
          exchange.sendResponseHeaders(200, -1);
          exchange.close();
        });
    server.start();
    try {
      assertThrows(
          BusinessException.class,
          () -> client.exchange(provider(issuer), "code", "nonce", "verifier"));
      assertTrue(!redirected.get());
    } finally {
      server.stop(0);
    }
  }

  @Test
  void acceptsEs256AndRejectsTokenSuppliedKeyLocations() throws Exception {
    var provider = provider("https://issuer.example");
    var ec = new ECKeyGenerator(Curve.P_256).keyID("trusted-ec").generate();
    var valid =
        new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(ec.getKeyID()).build(),
            claims(provider.getIssuer()).build());
    valid.sign(new ECDSASigner(ec));
    assertEquals(
        "subject-123",
        client.verify(
            provider, valid.serialize(), "expected-nonce", null, new JWKSet(ec.toPublicJWK())));
    RSAKey rsa = new RSAKeyGenerator(2048).keyID("trusted-rsa").generate();
    for (JWSHeader header :
        List.of(
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(rsa.getKeyID())
                .jwkURL(java.net.URI.create("https://attacker.invalid/keys"))
                .build(),
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(rsa.getKeyID())
                .x509CertURL(java.net.URI.create("https://attacker.invalid/cert"))
                .build(),
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(rsa.getKeyID())
                .jwk(rsa.toPublicJWK())
                .build(),
            new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("unknown-kid").build())) {
      var token = new SignedJWT(header, claims(provider.getIssuer()).build());
      token.sign(new RSASSASigner(rsa));
      assertThrows(
          BusinessException.class,
          () ->
              client.verify(
                  provider,
                  token.serialize(),
                  "expected-nonce",
                  null,
                  new JWKSet(rsa.toPublicJWK())));
    }
  }

  @Test
  void cancelsOversizedResponseWhileReceivingBody() throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    String issuer = "http://127.0.0.1:" + server.getAddress().getPort();
    server.createContext(
        "/token",
        exchange -> {
          byte[] body = new byte[1048577];
          exchange.sendResponseHeaders(200, body.length);
          try {
            exchange.getResponseBody().write(body);
          } catch (java.io.IOException cancelled) {
            /* 客户端达到上限后取消属于预期结果。 */
          } finally {
            exchange.close();
          }
        });
    server.start();
    try {
      assertThrows(
          BusinessException.class,
          () -> client.exchange(provider(issuer), "code", "nonce", "verifier"));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void totpMatchesRfcVectorsRejectsReplayAndWrongWindow() {
    String secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    assertEquals("94287082", Totp.code(secret, 59 / 30, 8));
    assertEquals("07081804", Totp.code(secret, 1111111109L / 30, 8));
    assertEquals("14050471", Totp.code(secret, 1111111111L / 30, 8));
    assertEquals("89005924", Totp.code(secret, 1234567890L / 30, 8));
    long step = NOW.getEpochSecond() / 30;
    String value = Totp.code(secret, step, 6);
    assertEquals(step, Totp.verify(secret, value, NOW, -1));
    assertEquals(-1, Totp.verify(secret, value, NOW, step));
    assertEquals(-1, Totp.verify(secret, value, NOW.plusSeconds(90), -1));
    assertTrue(Totp.newSecret().matches("[A-Z2-7]{32}"));
  }

  @Test
  void encryptedSecretsAreAuthenticatedPurposeBoundAndRandomized() {
    var properties = new IdentityProperties(new MockEnvironment());
    properties.setEncryptionKey(Base64.getEncoder().encodeToString(new byte[32]));
    var secrets = new IdentitySecrets(properties);
    String first = secrets.encrypt("shared-secret", "mfa:123");
    assertNotEquals(first, secrets.encrypt("shared-secret", "mfa:123"));
    assertEquals("shared-secret", secrets.decrypt(first, "mfa:123"));
    assertThrows(IllegalStateException.class, () -> secrets.decrypt(first, "mfa:456"));
    assertThrows(
        IllegalStateException.class,
        () -> secrets.decrypt(first.substring(0, first.length() - 3) + "AAA", "mfa:123"));
    assertThrows(
        IllegalStateException.class, () -> IdentitySecrets.validateKey("example-password"));
  }

  @Test
  void existingMfaCredentialsRequireMatchingKeyEvenWhenNewEnrollmentIsDisabled() throws Exception {
    var properties = new IdentityProperties(new MockEnvironment());
    properties.setEncryptionKey(Base64.getEncoder().encodeToString(new byte[32]));
    var secrets = new IdentitySecrets(properties);
    String cipher = secrets.encrypt("persisted-only-test-secret", "mfa:123");
    JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
    java.sql.ResultSet row = org.mockito.Mockito.mock(java.sql.ResultSet.class);
    org.mockito.Mockito.when(row.getString("secret_cipher")).thenReturn(cipher);
    org.mockito.Mockito.when(row.getLong("user_id")).thenReturn(123L);
    org.mockito.Mockito.doAnswer(
            invocation -> {
              invocation.<RowCallbackHandler>getArgument(1).processRow(row);
              return null;
            })
        .when(jdbc)
        .query(
            org.mockito.ArgumentMatchers.eq("select user_id,secret_cipher from sys_mfa_credential"),
            org.mockito.ArgumentMatchers.any(RowCallbackHandler.class));
    var guard = new IdentityStartupGuard(secrets, jdbc);
    guard.afterPropertiesSet();
    properties.setEncryptionKey("");
    assertThrows(IllegalStateException.class, () -> guard.afterPropertiesSet());
    byte[] replacement = new byte[32];
    replacement[0] = 1;
    properties.setEncryptionKey(Base64.getEncoder().encodeToString(replacement));
    assertThrows(IllegalStateException.class, () -> guard.afterPropertiesSet());
  }

  @Test
  void productionRefusesHttpAndMissingIndependentKey() {
    var properties =
        new IdentityProperties(
            new MockEnvironment().withProperty("mayday.deployment.production", "true"));
    properties.setProviders(List.of(provider("http://127.0.0.1:12345")));
    assertThrows(IllegalStateException.class, properties::afterPropertiesSet);
    var local = new IdentityProperties(new MockEnvironment());
    local.setMfaEnabled(true);
    assertThrows(IllegalStateException.class, local::afterPropertiesSet);
    local.setEncryptionKey(Base64.getEncoder().encodeToString(new byte[32]));
    local.afterPropertiesSet();
    assertEquals(
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        OidcClient.pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
  }
}
