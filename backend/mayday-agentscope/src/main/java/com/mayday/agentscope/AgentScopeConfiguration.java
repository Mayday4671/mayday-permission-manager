package com.mayday.agentscope;

import com.mayday.common.ModuleSwitches;
import io.agentscope.core.state.AgentStateStore;
import io.agentscope.extensions.jdbc.dialect.AbstractJdbcDialect;
import io.agentscope.extensions.jdbc.state.JdbcAgentStateStore;
import javax.sql.DataSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AgentScope 独立模块的运行配置。JDBC 状态使用项目统一 DataSource 与 Flyway 管理的表， 不允许 AgentScope
 * 在运行时自行建表；模块关闭只隐藏入口，不影响数据库升级和会话保留。
 */
@Configuration
@EnableConfigurationProperties(AgentScopeSettings.class)
public class AgentScopeConfiguration {
  /**
   * 注册 AgentScope 官方的 MySQL JDBC 状态实现。表名使用项目命名空间，避免与其他系统内的 AgentScope 实例互相覆盖；DDL 由 V32
   * 迁移执行，并为每个字段提供项目要求的中文注释。
   */
  @Bean
  @DependsOnDatabaseInitialization
  AgentStateStore agentScopeStateStore(DataSource dataSource) {
    AbstractJdbcDialect dialect =
        AbstractJdbcDialect.from(dataSource)
            .sessionStateTableName("ai_agent_state")
            .autoCreateTable(false)
            .build();
    return new JdbcAgentStateStore(dataSource, dialect, false);
  }

  /** 模块开关由公共 ModuleSwitches 统一校验；此参数用于防止未启用时意外构造模型客户端。 */
  @Bean
  AgentScopeModuleGuard agentScopeModuleGuard(ModuleSwitches switches) {
    return new AgentScopeModuleGuard(switches);
  }
}
