package com.mayday.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;

/** 生产门禁覆盖独立凭据、来源格式、禁止演示/root、既有默认密码；本地模式保留开发体验。 */
class ProductionSafetyTest {
  private final UserRepository users = mock(UserRepository.class);
  private final PasswordEncoder encoder = mock(PasswordEncoder.class);

  private MockEnvironment environment() {
    return new MockEnvironment()
        .withProperty("mayday.deployment.production", "true")
        .withProperty("spring.datasource.password", "Db_Random_Test_16!")
        .withProperty("spring.datasource.username", "mayday_runtime")
        .withProperty("mayday.admin-password", "Admin_Random_Test_16!")
        .withProperty("mayday.deployment.public-origin", "https://portal.company.test")
        .withProperty("springdoc.api-docs.enabled", "false")
        .withProperty("mayday.seed-demo-data", "false");
  }

  @Test
  void explicitDevelopmentAndSecureProductionAreAccepted() {
    assertDoesNotThrow(
        () -> new ProductionSafety(new MockEnvironment(), users, encoder).afterPropertiesSet());
    assertDoesNotThrow(
        () -> new ProductionSafety(environment(), users, encoder).afterPropertiesSet());
  }

  @Test
  void unsafeSettingsAreRejectedWithoutExposingValues() {
    var invalid =
        Map.of(
            "spring.datasource.password", "MaydayDb_2026_local",
            "mayday.admin-password", "Mayday@2026",
            "spring.datasource.username", "root",
            "springdoc.api-docs.enabled", "true",
            "mayday.seed-demo-data", "true");
    invalid.forEach(
        (key, value) -> {
          var env = environment().withProperty(key, value);
          var error =
              assertThrows(
                  IllegalStateException.class,
                  () -> new ProductionSafety(env, users, encoder).afterPropertiesSet());
          if (key.contains("password")) assertFalse(error.getMessage().contains(value));
        });
  }

  @Test
  void originMustNotContainCredentialsQueryFragmentOrSubpath() {
    for (String origin :
        new String[] {
          "",
          "http://portal.test",
          "https://user:secret@portal.test",
          "https://portal.test/admin",
          "https://portal.test?secret=1",
          "https://portal.test#admin",
          "not-a-url"
        }) {
      var env = environment().withProperty("mayday.deployment.public-origin", origin);
      assertThrows(
          IllegalStateException.class,
          () -> new ProductionSafety(env, users, encoder).afterPropertiesSet());
    }
  }

  @Test
  void replacingEnvironmentDoesNotPretendExistingPasswordWasRotated() {
    var admin = new SysUser();
    admin.setPasswordHash("existing-hash");
    when(users.findByUsername("admin")).thenReturn(Optional.of(admin));
    when(encoder.matches("Mayday@2026", "existing-hash")).thenReturn(true);
    assertThrows(
        IllegalStateException.class,
        () -> new ProductionSafety(environment(), users, encoder).run(null));
  }
}
