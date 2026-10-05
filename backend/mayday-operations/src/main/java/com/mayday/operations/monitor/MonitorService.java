package com.mayday.operations.monitor;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.EntityVersions;
import com.mayday.common.ModuleSwitches;
import com.mayday.operations.MessagePublisher;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.lang.management.ManagementFactory;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 监控的实时采样、历史和告警共用同一指标；阈值不是系统参数任意键，编辑需要独立权限。 */
@Service
@RequiredArgsConstructor
public class MonitorService {
  private final MonitorSampleRepository samples;
  private final MonitorPolicyRepository policies;
  private final DataSource dataSource;
  private final AccessPolicy access;
  private final UserRepository users;
  private final MessagePublisher messages;
  private final ModuleSwitches modules;
  private final PlatformTransactionManager transactionManager;
  private final String nodeId = UUID.randomUUID().toString();

  /** CPU 使用率为0..100；不支持该系统计数器时为-1，由页面显示不可用而不伪造0。 */
  @Schema(
      name = "MonitorSnapshot",
      requiredProperties = {
        "time",
        "uptimeMs",
        "javaVersion",
        "processors",
        "threads",
        "heapUsed",
        "heapMax",
        "heapCommitted",
        "database",
        "databaseLatencyMs",
        "os",
        "timezone",
        "cpuUsage"
      })
  public record Snapshot(
      LocalDateTime time,
      long uptimeMs,
      String javaVersion,
      int processors,
      int threads,
      long heapUsed,
      long heapMax,
      long heapCommitted,
      boolean database,
      long databaseLatencyMs,
      String os,
      String timezone,
      double cpuUsage) {}

  /** 监控告警的安全配置投影，包含版本以防覆盖；不含内部领取时间或通知凭据。 */
  @Schema(
      name = "MonitorPolicyView",
      requiredProperties = {"version", "enabled", "heapThresholdPercent", "databaseThresholdMs"})
  public record PolicyView(
      Long version,
      boolean enabled,
      int heapThresholdPercent,
      long databaseThresholdMs,
      Long alertUserId) {}

  /** 告警更新白名单：内存比例、数据库延迟和有效接收人需符合约束，启用时接收人不可为空。 */
  @Schema(name = "MonitorPolicyEdit")
  public record EditPolicy(
      @NotNull Long version,
      boolean enabled,
      @Min(50) @Max(99) int heapThresholdPercent,
      @Min(10) @Max(60000) long databaseThresholdMs,
      Long alertUserId) {}

  /** 历史对外投影只包含可展示指标，不公开内部节点UUID或未来新增的持久化字段。 */
  @Schema(
      name = "MonitorHistoryPoint",
      requiredProperties = {
        "id",
        "createdAt",
        "heapUsed",
        "heapMax",
        "cpuUsage",
        "threads",
        "databaseHealthy",
        "databaseLatencyMs"
      })
  public record HistoryPoint(
      Long id,
      LocalDateTime createdAt,
      long heapUsed,
      long heapMax,
      double cpuUsage,
      int threads,
      boolean databaseHealthy,
      long databaseLatencyMs) {}

  /** 当前连接可用性使用3秒超时；故障时仍能返回进程指标，不向客户端展示数据库异常字符串。 */
  public Snapshot sample() {
    var memory = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
    var runtime = ManagementFactory.getRuntimeMXBean();
    var operatingSystem = ManagementFactory.getOperatingSystemMXBean();
    boolean databaseHealthy;
    long started = System.nanoTime();
    try (var connection = dataSource.getConnection()) {
      databaseHealthy = connection.isValid(3);
    } catch (java.sql.SQLException exception) {
      databaseHealthy = false;
    }
    double cpuUsage =
        operatingSystem instanceof com.sun.management.OperatingSystemMXBean extended
            ? extended.getProcessCpuLoad()
            : -1;
    return new Snapshot(
        BusinessTime.now(),
        runtime.getUptime(),
        System.getProperty("java.version"),
        operatingSystem.getAvailableProcessors(),
        ManagementFactory.getThreadMXBean().getThreadCount(),
        memory.getUsed(),
        memory.getMax(),
        memory.getCommitted(),
        databaseHealthy,
        (System.nanoTime() - started) / 1_000_000L,
        operatingSystem.getName(),
        ZoneId.systemDefault().getId(),
        cpuUsage < 0 ? -1 : cpuUsage * 100);
  }

  /** 读取本进程节点最近5至60分钟的最多120个真实采样，按时间升序展示；节点重启开始新的曲线，旧记录保留至7天。 */
  public List<HistoryPoint> history(int minutes) {
    access.require("monitor:view");
    if (minutes < 5 || minutes > 60) throw new BusinessException("趋势窗口需为5至60分钟");
    return samples
        .findByNodeIdAndCreatedAtGreaterThanEqualOrderByIdDesc(
            nodeId, BusinessTime.now().minusMinutes(minutes), PageRequest.of(0, 120))
        .stream()
        .sorted(Comparator.comparing(MonitorSample::getId))
        .map(
            sample ->
                new HistoryPoint(
                    sample.getId(),
                    sample.getCreatedAt(),
                    sample.getHeapUsed(),
                    sample.getHeapMax(),
                    sample.getCpuUsage(),
                    sample.getThreads(),
                    sample.isDatabaseHealthy(),
                    sample.getDatabaseLatencyMs()))
        .toList();
  }

  /** 读取固定监控策略需查看权限，未初始化不会凭空创建默认记录；安装迁移负责初始化。 */
  public PolicyView policy() {
    access.require("monitor:view");
    return view(policies.findById(1L).orElseThrow(() -> new BusinessException("监控策略尚未初始化")));
  }

  /** 独立配置权限与版本行锁保护阈值变更，接收人必须仍有监控查看权限；任一验证失败保持原策略。 */
  public PolicyView configure(EditPolicy request) {
    access.require("monitor:view");
    access.require("monitor:configure");
    return new TransactionTemplate(transactionManager)
        .execute(
            status -> {
              MonitorPolicy policy =
                  policies.lock().orElseThrow(() -> new BusinessException("监控策略尚未初始化"));
              EntityVersions.requireCurrent(policy, request.version());
              if (request.enabled() && request.alertUserId() == null)
                throw new BusinessException("启用告警时请选择接收人");
              if (request.alertUserId() != null)
                users
                    .findById(request.alertUserId())
                    .filter(user -> access.hasFor(user, "monitor:view"))
                    .orElseThrow(() -> new BusinessException("接收人需具有监控查看权限"));
              policy.setEnabled(request.enabled());
              policy.setHeapThresholdPercent(request.heapThresholdPercent());
              policy.setDatabaseThresholdMs(request.databaseThresholdMs());
              policy.setAlertUserId(request.alertUserId());
              return view(policies.saveAndFlush(policy));
            });
  }

  /** 每30秒采样，最多保留7天；趋势先独立提交，提醒故障不丢采样，消息关闭时仍保留趋势。 */
  @Scheduled(fixedDelay = 30000, initialDelay = 15000)
  public void collect() {
    Snapshot snapshot = sample();
    if (!snapshot.database()) return; // 数据库自身离线时不能向该库伪造“已持久化的告警”。
    try {
      isolatedTransaction()
          .executeWithoutResult(
              status -> {
                MonitorSample sample = new MonitorSample();
                sample.setNodeId(nodeId);
                sample.setHeapUsed(snapshot.heapUsed());
                sample.setHeapMax(snapshot.heapMax());
                sample.setCpuUsage(snapshot.cpuUsage());
                sample.setThreads(snapshot.threads());
                sample.setDatabaseHealthy(snapshot.database());
                sample.setDatabaseLatencyMs(snapshot.databaseLatencyMs());
                samples.save(sample);
                samples.deleteByCreatedAtBefore(BusinessTime.now().minusDays(7));
              });
    } catch (RuntimeException exception) {
      org.slf4j.LoggerFactory.getLogger(MonitorService.class).warn("监控采样未持久化，稍后重试");
      return;
    }
    // 采样已提交后再领取提醒；消息及冷却时间同事务，失败时下一次真实采样可重试。
    try {
      isolatedTransaction()
          .executeWithoutResult(
              status -> {
                MonitorPolicy policy = policies.lock().orElse(null);
                if (policy == null
                    || !policy.isEnabled()
                    || policy.getAlertUserId() == null
                    || !modules.isEnabled("notifications")) return;
                var recipient = users.findById(policy.getAlertUserId()).orElse(null);
                if (recipient == null || !access.hasFor(recipient, "monitor:view")) return;
                boolean heapAlert =
                    snapshot.heapMax() > 0
                        && snapshot.heapUsed() * 100.0 / snapshot.heapMax()
                            >= policy.getHeapThresholdPercent();
                boolean latencyAlert =
                    snapshot.databaseLatencyMs() >= policy.getDatabaseThresholdMs();
                if ((!heapAlert && !latencyAlert)
                    || (policy.getLastAlertAt() != null
                        && policy.getLastAlertAt().isAfter(BusinessTime.now().minusMinutes(30))))
                  return;
                messages.publish(
                    "monitor:" + nodeId + ":" + (System.currentTimeMillis() / 1_800_000L),
                    policy.getAlertUserId(),
                    "运行指标超出阈值",
                    heapAlert ? "JVM堆内存使用率超出配置阈值，请查看服务监控。" : "数据库响应时间超出配置阈值，请查看服务监控。",
                    "服务监控",
                    "MONITOR",
                    1L);
                policy.setLastAlertAt(BusinessTime.now());
              });
    } catch (RuntimeException exception) {
      org.slf4j.LoggerFactory.getLogger(MonitorService.class).warn("监控提醒尚未投递，下次采样重试");
    }
  }

  private TransactionTemplate isolatedTransaction() {
    TransactionTemplate transaction = new TransactionTemplate(transactionManager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    transaction.setTimeout(10);
    return transaction;
  }

  private static PolicyView view(MonitorPolicy policy) {
    return new PolicyView(
        policy.getVersion(),
        policy.isEnabled(),
        policy.getHeapThresholdPercent(),
        policy.getDatabaseThresholdMs(),
        policy.getAlertUserId());
  }
}
