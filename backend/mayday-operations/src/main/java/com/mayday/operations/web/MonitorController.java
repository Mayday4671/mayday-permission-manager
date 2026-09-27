package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.security.AccessPolicy;
import java.lang.management.ManagementFactory;
import java.time.*;
import java.util.*;
import javax.sql.DataSource;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/** 只暴露运行指标，不返回环境变量、连接字符串、线程栈或机器文件路径。 */
@RestController
@RequestMapping("/api/operations/monitor")
@RequiredArgsConstructor
public class MonitorController {
  private final AccessPolicy access;
  private final DataSource dataSource;

  @GetMapping
  public ApiResponse<?> status() {
    access.require("monitor:view");
    var memory = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
    var runtime = ManagementFactory.getRuntimeMXBean();
    var os = ManagementFactory.getOperatingSystemMXBean();
    boolean database;
    long begin = System.nanoTime();
    try (var c = dataSource.getConnection()) {
      database = c.isValid(2);
    } catch (Exception e) {
      database = false;
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("time", LocalDateTime.now());
    m.put("uptimeMs", runtime.getUptime());
    m.put("javaVersion", System.getProperty("java.version"));
    m.put("processors", os.getAvailableProcessors());
    m.put("threads", ManagementFactory.getThreadMXBean().getThreadCount());
    m.put("heapUsed", memory.getUsed());
    m.put("heapMax", memory.getMax());
    m.put("heapCommitted", memory.getCommitted());
    m.put("database", database);
    m.put("databaseLatencyMs", (System.nanoTime() - begin) / 1000000);
    m.put("os", os.getName());
    m.put("timezone", ZoneId.systemDefault().getId());
    return ApiResponse.ok(m);
  }
}
