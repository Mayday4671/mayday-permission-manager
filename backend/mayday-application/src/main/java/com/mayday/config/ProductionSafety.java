package com.mayday.config;

import com.mayday.system.repository.UserRepository;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * 显式生产模式的启动门禁：拒绝示例凭据、root运行账号、演示初始化和公开契约。 只验证可在进程内证明的配置；HTTPS证书、备份恢复及外部入口仍必须在部署环境验证。
 * 不自动修改数据库密码或既有账号，失败消息只包含配置名称，不能泄露凭据内容。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@RequiredArgsConstructor
public class ProductionSafety implements InitializingBean, ApplicationRunner {
  private final Environment environment;
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private static final Set<String> EXAMPLE_SECRETS =
      Set.of("MaydayDb_2026_local", "MaydayRoot_2026_local", "Mayday@2026");

  /** Bean初始化阶段拒绝不安全配置，不能等到首次业务请求时才发现生产门禁未通过。 */
  @Override
  public void afterPropertiesSet() {
    if (!production()) return;
    List<String> failures = new ArrayList<>();
    String dbPassword = environment.getProperty("spring.datasource.password", "");
    String adminPassword = environment.getProperty("mayday.admin-password", "");
    if (dbPassword.length() < 16 || EXAMPLE_SECRETS.contains(dbPassword))
      failures.add("DB_PASSWORD必须替换为至少16位独立凭据");
    if (adminPassword.length() < 16 || EXAMPLE_SECRETS.contains(adminPassword))
      failures.add("ADMIN_PASSWORD必须替换为至少16位独立凭据");
    if ("root".equalsIgnoreCase(environment.getProperty("spring.datasource.username", "")))
      failures.add("DB_USERNAME不能使用root");
    if (environment.getProperty("mayday.seed-demo-data", Boolean.class, false))
      failures.add("SEED_DEMO_DATA必须关闭");
    if (environment.getProperty("springdoc.api-docs.enabled", Boolean.class, true))
      failures.add("API_DOCS_ENABLED必须关闭");
    if (!secureOrigin(environment.getProperty("mayday.deployment.public-origin", "")))
      failures.add("MAYDAY_PUBLIC_ORIGIN必须是无凭据/路径/查询参数的HTTPS站点来源");
    if (!failures.isEmpty())
      throw new IllegalStateException("生产启动检查未通过：" + String.join("；", failures));
  }

  /** 初始化既有库后检查管理员是否仍使用公开示例密码；修改环境变量不能冒充已经轮换数据库凭据。 */
  @Override
  public void run(ApplicationArguments arguments) {
    if (!production()) return;
    users
        .findByUsername("admin")
        .ifPresent(
            user -> {
              if (encoder.matches("Mayday@2026", user.getPasswordHash()))
                throw new IllegalStateException("生产启动检查未通过：既有管理员仍使用示例密码，请先完成账号密码轮换");
            });
  }

  private boolean production() {
    return environment.getProperty("mayday.deployment.production", Boolean.class, false);
  }

  private static boolean secureOrigin(String value) {
    try {
      URI origin = URI.create(value);
      return "https".equalsIgnoreCase(origin.getScheme())
          && origin.getHost() != null
          && origin.getRawUserInfo() == null
          && origin.getRawQuery() == null
          && origin.getRawFragment() == null
          && (origin.getRawPath() == null
              || origin.getRawPath().isEmpty()
              || "/".equals(origin.getRawPath()));
    } catch (IllegalArgumentException invalid) {
      return false;
    }
  }
}
