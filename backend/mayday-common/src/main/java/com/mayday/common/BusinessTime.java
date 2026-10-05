package com.mayday.common;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Objects;

/**
 * 业务日期和 DATETIME 的唯一时间来源：按既有数据库约定使用北京时间，不依赖服务器默认时区。
 *
 * <p>DATETIME 表示业务墙上时间，不携带偏移量；持久层必须通过 JDBC 4.2 直接绑定 java.time 类型， 数据库连接的会话时区也必须一致。安全令牌、验证码和租约的
 * Instant/epoch 时间点仍由各自的 UTC 时钟处理， 不能通过本类转换后作为时间点保存。本类不修改 JVM 全局时区，其他可复用模块仍能使用自己的明确时区。
 */
public final class BusinessTime {
  private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
  private static final Clock CLOCK = Clock.systemUTC();

  private BusinessTime() {}

  /** 返回数据库和业务日历约定的时区，供报表分组与接口时区说明共同使用。 */
  public static ZoneId zone() {
    return ZONE;
  }

  /** 返回当前北京时间；不得改用 LocalDateTime.now() 继承部署机器的时区。 */
  public static LocalDateTime now() {
    return now(CLOCK);
  }

  /** 从指定时钟的时间点换算业务时间；忽略时钟自身的时区，便于确定性边界测试。 */
  public static LocalDateTime now(Clock clock) {
    return LocalDateTime.ofInstant(Objects.requireNonNull(clock, "clock").instant(), ZONE);
  }

  /** 返回当前业务日期，避免 UTC 服务器在北京时间零点后的八小时内统计到前一天。 */
  public static LocalDate today() {
    return today(CLOCK);
  }

  /** 使用与 now(Clock) 相同的业务区推导日期，覆盖跨日边界而不依赖测试宿主机。 */
  public static LocalDate today(Clock clock) {
    return now(clock).toLocalDate();
  }
}
