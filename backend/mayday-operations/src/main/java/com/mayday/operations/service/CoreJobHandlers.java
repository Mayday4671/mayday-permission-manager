package com.mayday.operations.service;

import com.mayday.system.repository.SessionRepository;
import java.time.Instant;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 内置处理器只执行框架维护；检查结果不暴露全站用户数量、连接字符串或数据库凭据。 */
@Configuration
public class CoreJobHandlers {
  @Bean
  JobHandler sessionCleanupHandler(SessionRepository sessions) {
    return new JobHandler() {
      @Override
      public String key() {
        return "SESSION_CLEANUP";
      }

      @Override
      public String label() {
        return "清理过期会话";
      }

      @Override
      public String execute() {
        sessions.deleteByExpiresAtBefore(Instant.now());
        return "已清理过期会话";
      }
    };
  }

  @Bean
  JobHandler databaseCheckHandler(DataSource dataSource) {
    return new JobHandler() {
      @Override
      public String key() {
        return "DATABASE_CHECK";
      }

      @Override
      public String label() {
        return "检查数据库连接";
      }

      @Override
      public String execute() {
        try (var connection = dataSource.getConnection()) {
          if (!connection.isValid(3)) throw new IllegalStateException("数据库连接检查失败");
          return "数据库连接正常";
        } catch (java.sql.SQLException exception) {
          throw new IllegalStateException("数据库连接检查失败", exception);
        }
      }
    };
  }
}
