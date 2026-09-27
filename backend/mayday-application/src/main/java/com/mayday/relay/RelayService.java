package com.mayday.relay;

import com.mayday.common.BusinessException;
import com.mayday.netty.*;
import com.mayday.operations.OperationSupport;
import com.mayday.security.AccessPolicy;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.Objects;

/**
 * 单实例后台适配层：只在配置/启停时访问数据库，数据包绝不经过控制器、权限服务或 JPA。
 * 配置提交、启动、停止共用锁，事务在锁内提交，避免“保存尚未提交，另一请求已启动旧配置”。
 * 应用重启默认停止，绝不根据数据库配置自动占用端口；已运行转发不依赖浏览器是否打开。
 */
@Service
public class RelayService {
  private final RelaySettingsRepository repository;
  private final AccessPolicy access;
  private final TransactionTemplate transaction;
  private final UdpRelay relay=new UdpRelay();
  public RelayService(RelaySettingsRepository repository,AccessPolicy access,PlatformTransactionManager manager) {
    this.repository=repository;this.access=access;this.transaction=new TransactionTemplate(manager);
  }
  private RelaySettings settings() { return repository.findById(1L).orElseThrow(()->new BusinessException("转发配置尚未初始化，请检查数据库迁移")); }
  public synchronized RelaySettings config() { access.require("relay:view");return settings(); }
  public RelaySnapshot stats() { access.require("relay:view");return relay.snapshot(); }
  public synchronized RelaySettings save(RelayConfig config,Long version) {
    access.require("relay:view");access.require("relay:configure");
    if(relay.snapshot().state().equals("RUNNING"))throw new BusinessException("请先停止转发再修改配置");
    return transaction.execute(status->{var row=settings();OperationSupport.version(row,version);row.apply(config);return repository.saveAndFlush(row);});
  }
  public synchronized RelaySnapshot start(Long version) {
    access.require("relay:view");access.require("relay:control");
    var row=settings();OperationSupport.version(row,version);
    try { return relay.start(row.toConfig()); }
    catch(IllegalArgumentException|IllegalStateException error) { throw new BusinessException(error.getMessage()); }
  }
  public synchronized RelaySnapshot stop(String runId) {
    access.require("relay:view");access.require("relay:control");
    if(!Objects.equals(runId,relay.snapshot().runId()))throw new BusinessException("转发批次已变化，请刷新后重试");
    return relay.stop();
  }
  @PreDestroy public synchronized void close() { relay.close(); }
}
