package com.mayday.identity;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** 企业身份是显式部署配置，不能由匿名输入指定请求地址；缺少独立密钥时禁止开启 MFA/OIDC。 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "mayday.identity")
public class IdentityProperties implements InitializingBean {
  private final Environment environment;
  private boolean mfaEnabled;
  private String encryptionKey = "";
  private String issuerLabel = "Mayday";
  private List<Provider> providers = new ArrayList<>();

  public IdentityProperties(Environment environment) {
    this.environment = environment;
  }

  /** 固定授权地址、令牌地址和 JWKS 地址；外部角色、邮箱均不参与本地账号与角色分配。 */
  @Getter
  @Setter
  public static class Provider {
    private String id;
    private String name;
    private String issuer;
    private String clientId;
    private String clientSecret;
    private String authorizationUri;
    private String tokenUri;
    private String jwksUri;
    private String redirectUri;
    private String clientAuthentication = "client_secret_basic";
    private boolean enabled = true;
  }

  /** 生产只允许 HTTPS；开发 HTTP 仅允许字面 loopback，不把任意 HTTP/内网目标当成安全默认值。 */
  @Override
  public void afterPropertiesSet() {
    boolean production =
        environment.getProperty("mayday.deployment.production", Boolean.class, false);
    if (issuerLabel == null || issuerLabel.isBlank() || issuerLabel.length() > 64)
      throw new IllegalStateException("认证器的签发机构名称需为 1 至 64 个字符");
    if (providers.size() > 10) throw new IllegalStateException("企业身份提供方最多注册 10 个");
    var ids = new HashSet<String>();
    for (Provider provider : providers) {
      if (provider.id == null
          || !provider.id.matches("[a-z][a-z0-9-]{0,31}")
          || !ids.add(provider.id)) throw new IllegalStateException("企业身份提供方标识必须唯一且使用小写字母、数字和短横线");
      if (!provider.enabled) continue;
      if (provider.name == null
          || provider.name.isBlank()
          || provider.name.length() > 64
          || provider.clientId == null
          || provider.clientId.isBlank()
          || provider.clientId.length() > 255
          || provider.clientSecret == null
          || provider.clientSecret.isBlank()) throw new IllegalStateException("企业身份提供方名称和客户端凭据未配置");
      if (!List.of("client_secret_basic", "client_secret_post")
          .contains(provider.clientAuthentication))
        throw new IllegalStateException("OIDC 客户端认证仅支持 client_secret_basic/post");
      for (String value :
          new String[] {
            provider.issuer,
            provider.authorizationUri,
            provider.tokenUri,
            provider.jwksUri,
            provider.redirectUri
          }) {
        if (!allowedUri(value, production))
          throw new IllegalStateException("OIDC 地址必须使用无凭据、无片段的 HTTPS，开发仅允许 loopback HTTP");
      }
      URI redirect = URI.create(provider.redirectUri);
      if (URI.create(provider.issuer).getRawQuery() != null)
        throw new IllegalStateException("OIDC issuer 不能包含查询参数");
      if (!"/auth/oidc/callback".equals(redirect.getPath()) || redirect.getQuery() != null)
        throw new IllegalStateException("OIDC 回调必须是固定 /auth/oidc/callback 路径");
    }
    if (mfaEnabled || providers.stream().anyMatch(Provider::isEnabled))
      IdentitySecrets.validateKey(encryptionKey);
  }

  /** 只接受部署注册的启用提供方，不能将用户提交的 URL 转换为服务端 HTTP 请求。 */
  public Provider provider(String id) {
    return providers.stream()
        .filter(provider -> provider.enabled && provider.id.equals(id))
        .findFirst()
        .orElseThrow(() -> new com.mayday.common.BusinessException("企业登录方式未启用"));
  }

  private static boolean allowedUri(String value, boolean production) {
    if (value == null) return false;
    try {
      URI uri = URI.create(value);
      return uri.getHost() != null
          && uri.getUserInfo() == null
          && uri.getFragment() == null
          && ("https".equals(uri.getScheme())
              || (!production
                  && "http".equals(uri.getScheme())
                  && List.of("127.0.0.1", "localhost", "[::1]").contains(uri.getHost())));
    } catch (IllegalArgumentException invalid) {
      return false;
    }
  }
}
