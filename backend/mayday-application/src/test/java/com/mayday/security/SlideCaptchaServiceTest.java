package com.mayday.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.mayday.common.BusinessException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/** 使用可控时钟验证过期和原子消费；不把测试答案或绕过开关带入生产接口。 */
class SlideCaptchaServiceTest {
  /** 独立可推进的 UTC 时钟，使挑战与证明过期检查可复现，测试无需真实等待。 */
  static class TestClock extends Clock {
    long now = 1_000_000;

    /** 与生产挑战时钟保持 UTC，避免本机默认时区影响固定有效期断言。 */
    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    /** 测试只检查毫秒期限，继续返回当前可控时钟，不额外引入真实时钟状态。 */
    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    /** 从用例推进的毫秒值计算当前时间，让并发消费与过期测试共享同一时间线。 */
    @Override
    public Instant instant() {
      return Instant.ofEpochMilli(now);
    }
  }

  final TestClock clock = new TestClock();
  final SlideCaptchaService service =
      new SlideCaptchaService(
          new SecureRandom() {
            @Override
            public int nextInt(int bound) {
              return 0;
            }
          },
          clock);

  /** 经正常挑战和校验入口生成一次性证明，不绕过服务端消费与账号/来源绑定。 */
  String proof() {
    var puzzle = service.issue("admin", "source");
    clock.now += 500;
    return service.verify(puzzle.challengeId(), "admin", "source", 64, 500).captchaToken();
  }

  @Test
  void successfulProofCanOnlyBeConsumedOnceEvenConcurrently() {
    String token = proof();
    long success =
        IntStream.range(0, 12)
            .parallel()
            .filter(
                i -> {
                  try {
                    service.consume(token, "admin", "source");
                    return true;
                  } catch (BusinessException e) {
                    return false;
                  }
                })
            .count();
    assertEquals(1, success);
  }

  @Test
  void wrongOffsetConsumesChallengeAndPreventsGuessing() {
    var puzzle = service.issue("admin", "source");
    clock.now += 500;
    assertThrows(
        BusinessException.class,
        () -> service.verify(puzzle.challengeId(), "admin", "source", 90, 500));
    assertThrows(
        BusinessException.class,
        () -> service.verify(puzzle.challengeId(), "admin", "source", 64, 500));
  }

  @Test
  void challengeAndProofAreBoundToAccountAndSource() {
    var puzzle = service.issue("admin", "source");
    clock.now += 500;
    assertThrows(
        BusinessException.class,
        () -> service.verify(puzzle.challengeId(), "other", "source", 64, 500));
    var next = service.issue("admin", "source");
    clock.now += 500;
    final String id = next.challengeId();
    assertThrows(BusinessException.class, () -> service.verify(id, "admin", "other-ip", 64, 500));
    String first = proof();
    assertThrows(BusinessException.class, () -> service.consume(first, "other", "source"));
    String second = proof();
    assertThrows(BusinessException.class, () -> service.consume(second, "admin", "other-ip"));
  }

  @Test
  void expiredChallengesAndProofsFailClosed() {
    var puzzle = service.issue("admin", "source");
    clock.now += 120_000;
    assertThrows(
        BusinessException.class,
        () -> service.verify(puzzle.challengeId(), "admin", "source", 64, 500));
    String token = proof();
    clock.now += 60_000;
    assertThrows(BusinessException.class, () -> service.consume(token, "admin", "source"));
  }

  @Test
  void instantOrFabricatedDurationsAreRejected() {
    var first = service.issue("admin", "source");
    assertThrows(
        BusinessException.class,
        () -> service.verify(first.challengeId(), "admin", "source", 64, 500));
    var second = service.issue("admin", "source");
    clock.now += 500;
    assertThrows(
        BusinessException.class,
        () -> service.verify(second.challengeId(), "admin", "source", 64, 1));
    var third = service.issue("admin", "source");
    clock.now += 500;
    assertThrows(
        BusinessException.class,
        () -> service.verify(third.challengeId(), "admin", "source", 64, 5000));
  }

  @Test
  void refreshInvalidatesOldChallengeAndSourceQuotaExpires() {
    var first = service.issue("admin", "source");
    service.issue("admin", "source");
    clock.now += 500;
    assertThrows(
        BusinessException.class,
        () -> service.verify(first.challengeId(), "admin", "source", 64, 500));
    for (int i = 0; i < 118; i++) service.issue("admin", "source");
    assertThrows(BusinessException.class, () -> service.issue("admin", "source"));
    clock.now += 60_000;
    assertNotNull(service.issue("admin", "source"));
    assertThrows(BusinessException.class, () -> service.consume("forged", "admin", "source"));
  }
}
