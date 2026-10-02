package com.mayday.relay;

import com.mayday.common.BusinessException;
import com.mayday.netty.RelayConfig;
import com.mayday.netty.RelaySnapshot;
import com.mayday.netty.UdpRelay;
import com.mayday.operations.OperationSupport;
import com.mayday.security.AccessPolicy;
import jakarta.annotation.PreDestroy;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 单实例后台适配层：只在配置/启停时访问数据库，数据包绝不经过控制器、权限服务或 JPA。 配置提交、启动、停止共用锁，事务在锁内提交，避免“保存尚未提交，另一请求已启动旧配置”。
 * 应用重启默认停止，绝不根据数据库配置自动占用端口；已运行转发不依赖浏览器是否打开。
 */
@Service
public class RelayService {
  private final RelaySettingsRepository repository;
  private final AccessPolicy access;
  private final TransactionTemplate transaction;
  private final UdpRelay relay = new UdpRelay();

  /** 将 JPA 配置、事务边界和授权接入独立转发核心，数据库事务只在控制面运行。 */
  public RelayService(
      RelaySettingsRepository repository, AccessPolicy access, PlatformTransactionManager manager) {
    this.repository = repository;
    this.access = access;
    this.transaction = new TransactionTemplate(manager);
  }

  private RelaySettings settings() {
    return repository.findById(1L).orElseThrow(() -> new BusinessException("转发配置尚未初始化，请检查数据库迁移"));
  }

  /** 查看固定单实例配置；同步锁与保存/启停共用，确保读取不会穿过控制状态变更。 */
  public synchronized RelaySettings config() {
    access.require("relay:view");
    return settings();
  }

  /** 返回核心维护的实时统计快照，查看不触发包处理或数据库写入。 */
  public RelaySnapshot stats() {
    access.require("relay:view");
    return relay.snapshot();
  }

  /** 仅停止时允许配置，验证并发版本后在共用锁内提交事务，避免启动读取未提交配置。 */
  public synchronized RelaySettings save(RelayConfig config, Long version) {
    access.require("relay:view");
    access.require("relay:configure");
    if (relay.snapshot().state().equals("RUNNING")) throw new BusinessException("请先停止转发再修改配置");
    return transaction.execute(
        status -> {
          var row = settings();
          OperationSupport.version(row, version);
          row.apply(config);
          return repository.saveAndFlush(row);
        });
  }

  /** relay:control 授权后只启动已保存且版本匹配的配置，转发数据面完全绕开 Spring/JPA。 */
  public synchronized RelaySnapshot start(Long version) {
    access.require("relay:view");
    access.require("relay:control");
    var row = settings();
    OperationSupport.version(row, version);
    try {
      return relay.start(row.toConfig());
    } catch (IllegalArgumentException | IllegalStateException error) {
      throw new BusinessException(error.getMessage());
    }
  }

  /** 只停止调用者明确指定的当前运行批次，旧页面持有的 runId 不能干扰新批次。 */
  public synchronized RelaySnapshot stop(String runId) {
    access.require("relay:view");
    access.require("relay:control");
    if (!Objects.equals(runId, relay.snapshot().runId()))
      throw new BusinessException("转发批次已变化，请刷新后重试");
    return relay.stop();
  }

  /** 应用退出时释放核心线程和套接字；重启不会依据历史配置自动占用网络端口。 */
  @PreDestroy
  public synchronized void close() {
    relay.close();
  }
}
