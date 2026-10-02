package com.mayday.security;

import com.mayday.common.BusinessException;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.geom.AffineTransform;
import java.awt.geom.Area;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;

/**
 * 自托管登录拼图：答案只在服务端保存，前端只收到栅格图片，不下发目标坐标或可解码答案。 挑战、通过凭证均一次性，绑定账号和请求来源；先消费再判断，错误尝试不能反复猜同一道题。
 * 这是基础自动化滥用拦截，不代替密码限流、MFA 或专业风控。当前单实例内存存储有 TTL、 来源配额和全局容量上限；多实例部署必须替换为共享存储及原子消费，不能关闭验证绕过。
 */
@Component
public class SlideCaptchaService {
  /** 背景栅格的固定宽度，客户端拖动坐标需换算为此像素尺度。 */
  public static final int WIDTH = 320;

  /** 背景栅格的固定高度，与公开响应里的尺寸保持一致。 */
  public static final int HEIGHT = 160;

  /** 拼图块尺寸包含轮廓突出部分，验证可接受的最大偏移由背景宽度减去此值确定。 */
  public static final int SIZE = 48;

  private static final long CHALLENGE_TTL = 120_000;
  private static final long PROOF_TTL = 60_000;
  private static final int CAPACITY = 2048;
  private static final int PER_SOURCE_MINUTE = 120;
  private static final String INVALID = "验证未通过或已过期，请重新拖动滑块";
  private final SecureRandom random;
  private final Clock clock;
  private final Map<String, Challenge> challenges = new HashMap<>();
  private final Map<String, Proof> proofs = new HashMap<>();
  private final Map<String, RateWindow> windows = new HashMap<>();

  /** 服务端挑战答案及绑定上下文；目标横坐标只留在进程内，不包含在任何公开响应。 */
  private record Challenge(String username, String source, int x, long issuedAt) {}

  /** 通过拼图后的短期一次性凭证；仍绑定用户名与来源，不能代替密码登录或跨账号使用。 */
  private record Proof(String username, String source, long expiresAt) {}

  /** 同来源一分钟挑战配额，到期时整个窗口失效，不延长攻击者持续刷新请求的计数周期。 */
  private record RateWindow(int count, long expiresAt) {}

  /** 仅下发背景、拼图栅格和必要尺寸；纵坐标可公开，目标横坐标与图形矢量描述绝不返回。 */
  public record Puzzle(
      String challengeId,
      String background,
      String piece,
      int width,
      int height,
      int pieceSize,
      int y,
      int expiresIn) {}

  /** 登录前仅能消费一次的短期证明；页面应按 expiresIn 秒重新验证，不能持久化为登录会话。 */
  public record Verification(String captchaToken, int expiresIn) {}

  /** 生产构造使用安全随机数和 UTC 时钟；测试不能通过公开 API 设置固定答案或跳过校验。 */
  public SlideCaptchaService() {
    this(new SecureRandom(), Clock.systemUTC());
  }

  // 包级注入只用于单元测试时间与随机数，不提供任何 HTTP 测试开关或固定答案。
  SlideCaptchaService(SecureRandom random, Clock clock) {
    this.random = random;
    this.clock = clock;
  }

  /** 所有入口先清除过期项，容量判断不会把已经失效的挑战或凭证算作仍在使用。 */
  private void prune(long now) {
    challenges.values().removeIf(challenge -> now - challenge.issuedAt() >= CHALLENGE_TTL);
    proofs.values().removeIf(proof -> now >= proof.expiresAt());
    windows.values().removeIf(window -> now >= window.expiresAt());
  }

  private String nonce() {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  /** 不查询账号是否存在，避免挑战接口成为用户名探测入口。 */
  public synchronized Puzzle issue(String username, String source) {
    long now = clock.millis();
    prune(now);
    RateWindow previousWindow = windows.get(source);
    if (challenges.size() >= CAPACITY
        || proofs.size() >= CAPACITY
        || windows.size() >= CAPACITY
        || (previousWindow != null && previousWindow.count() >= PER_SOURCE_MINUTE))
      throw new BusinessException("验证请求过于频繁，请稍后再试");
    windows.put(
        source,
        new RateWindow(
            previousWindow == null ? 1 : previousWindow.count() + 1,
            previousWindow == null ? now + 60_000 : previousWindow.expiresAt()));
    // 同来源/同账号换图即废弃旧题，控制刷新产生的存量，也避免多个有效答案并存。
    challenges
        .values()
        .removeIf(
            challenge ->
                challenge.username().equals(username) && challenge.source().equals(source));
    int x = 64 + random.nextInt(WIDTH - SIZE - 80), y = 24 + random.nextInt(HEIGHT - SIZE - 40);
    String id = nonce();
    String[] images = render(x, y);
    challenges.put(id, new Challenge(username, source, x, now));
    return new Puzzle(
        id, images[0], images[1], WIDTH, HEIGHT, SIZE, y, (int) (CHALLENGE_TTL / 1000));
  }

  /** 一题仅允许一次验证；时间检查在服务端执行，客户端耗时只作为附加约束。 */
  public synchronized Verification verify(
      String id, String username, String source, int x, long elapsedMs) {
    long now = clock.millis();
    prune(now);
    Challenge challenge = challenges.remove(id);
    if (challenge == null
        || !challenge.username().equals(username)
        || !challenge.source().equals(source)
        || x < 0
        || x > WIDTH - SIZE
        || Math.abs(x - challenge.x()) > 4
        || elapsedMs < 300
        || elapsedMs > CHALLENGE_TTL
        || now - challenge.issuedAt() < elapsedMs - 150
        || now - challenge.issuedAt() < 300) throw new BusinessException(INVALID);
    if (proofs.size() >= CAPACITY) throw new BusinessException("验证服务繁忙，请稍后再试");
    String token = nonce();
    proofs.put(token, new Proof(username, source, now + PROOF_TTL));
    return new Verification(token, (int) (PROOF_TTL / 1000));
  }

  /** 登录入口必须先消费此凭证再进行密码比较；密码错误也不会返还凭证。 */
  public synchronized void consume(String token, String username, String source) {
    long now = clock.millis();
    prune(now);
    Proof proof = token == null ? null : proofs.remove(token);
    if (proof == null || !proof.username().equals(username) || !proof.source().equals(source))
      throw new BusinessException("请先完成滑动验证");
  }

  /** 无外部图片请求，也不使用字体；每次生成不同几何纹理，并裁出真实拼图块。 */
  private String[] render(int x, int y) {
    BufferedImage background = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
    Graphics2D backgroundGraphics = background.createGraphics();
    backgroundGraphics.setRenderingHint(
        RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    backgroundGraphics.setPaint(
        new GradientPaint(0, 0, new Color(225, 235, 242), WIDTH, HEIGHT, new Color(147, 176, 188)));
    backgroundGraphics.fillRect(0, 0, WIDTH, HEIGHT);
    for (int index = 0; index < 38; index++) {
      backgroundGraphics.setColor(
          new Color(
              70 + random.nextInt(120), 100 + random.nextInt(110), 120 + random.nextInt(100), 120));
      int pointX = random.nextInt(WIDTH),
          pointY = random.nextInt(HEIGHT),
          size = 16 + random.nextInt(64);
      if (index % 2 == 0)
        backgroundGraphics.fillOval(pointX - size / 2, pointY - size / 2, size, size);
      else
        backgroundGraphics.fillRoundRect(
            pointX - size / 2, pointY - size / 2, size, size / 2, 6, 6);
    }
    Area shape = new Area(new RoundRectangle2D.Double(5, 10, 38, 33, 5, 5));
    shape.add(new Area(new Ellipse2D.Double(17, 2, 14, 16)));
    shape.add(new Area(new Ellipse2D.Double(35, 20, 12, 14)));
    shape.subtract(new Area(new Ellipse2D.Double(0, 20, 13, 14)));
    BufferedImage piece = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
    Graphics2D pieceGraphics = piece.createGraphics();
    pieceGraphics.setRenderingHint(
        RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    pieceGraphics.setClip(shape);
    pieceGraphics.drawImage(background, -x, -y, null);
    pieceGraphics.setClip(null);
    pieceGraphics.setColor(Color.WHITE);
    pieceGraphics.setStroke(new BasicStroke(1.5f));
    pieceGraphics.draw(shape);
    pieceGraphics.dispose();
    Shape gap = AffineTransform.getTranslateInstance(x, y).createTransformedShape(shape);
    backgroundGraphics.setColor(new Color(20, 30, 40, 150));
    backgroundGraphics.fill(gap);
    backgroundGraphics.setColor(new Color(255, 255, 255, 210));
    backgroundGraphics.setStroke(new BasicStroke(1.5f));
    backgroundGraphics.draw(gap);
    backgroundGraphics.dispose();
    return new String[] {png(background), png(piece)};
  }

  private static String png(BufferedImage image) {
    try {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      ImageIO.write(image, "png", bytes);
      return "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray());
    } catch (IOException error) {
      throw new IllegalStateException("无法生成登录验证图片", error);
    }
  }
}
