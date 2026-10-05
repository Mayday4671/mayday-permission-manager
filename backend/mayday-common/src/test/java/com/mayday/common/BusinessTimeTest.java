package com.mayday.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

/** 覆盖部署宿主不同时区、北京时间跨日以及安全时间点不能被业务时区平移的边界。 */
class BusinessTimeTest {
  @Test
  void sameInstantUsesBusinessZoneRegardlessOfClockZone() {
    Instant instant = Instant.parse("2026-10-05T06:00:00.123456Z");
    LocalDateTime expected = LocalDateTime.parse("2026-10-05T14:00:00.123456");
    for (String zone : new String[] {"UTC", "Asia/Shanghai", "America/New_York", "Asia/Tokyo"}) {
      Clock clock = Clock.fixed(instant, ZoneId.of(zone));
      assertEquals(expected, BusinessTime.now(clock));
      assertEquals(instant, clock.instant(), "业务区转换不能修改安全时钟的时间点");
    }
  }

  @Test
  void businessDateCrossesMidnightAtShanghaiBoundary() {
    assertEquals(
        LocalDate.of(2026, 10, 5),
        BusinessTime.today(Clock.fixed(Instant.parse("2026-10-04T16:00:00Z"), ZoneId.of("UTC"))));
    assertEquals(
        LocalDate.of(2026, 10, 4),
        BusinessTime.today(
            Clock.fixed(Instant.parse("2026-10-04T15:59:59.999999Z"), ZoneId.of("UTC"))));
    assertEquals(ZoneId.of("Asia/Shanghai"), BusinessTime.zone());
  }

  @Test
  void missingClockCannotSilentlyUseHostTime() {
    assertThrows(NullPointerException.class, () -> BusinessTime.now(null));
    assertThrows(NullPointerException.class, () -> BusinessTime.today(null));
  }
}
