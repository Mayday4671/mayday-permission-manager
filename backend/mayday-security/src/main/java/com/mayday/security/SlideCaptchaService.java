package com.mayday.security;

import com.mayday.common.BusinessException;
import java.awt.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.*;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;

/**
 * 自托管登录拼图：答案只在服务端保存，前端只收到栅格图片，不下发目标坐标或可解码答案。 挑战、通过凭证均一次性，绑定账号和请求来源；先消费再判断，错误尝试不能反复猜同一道题。
 * 这是基础自动化滥用拦截，不代替密码限流、MFA 或专业风控。当前单实例内存存储有 TTL、 来源配额和全局容量上限；多实例部署必须替换为共享存储及原子消费，不能关闭验证绕过。
 */
@Component
public class SlideCaptchaService {
  public static final int WIDTH = 320, HEIGHT = 160, SIZE = 48;
  private static final long CHALLENGE_TTL = 120_000, PROOF_TTL = 60_000;
  private static final int CAPACITY = 2048, PER_SOURCE_MINUTE = 120;
  private static final String INVALID = "验证未通过或已过期，请重新拖动滑块";
  private final SecureRandom random;
  private final Clock clock;
  private final Map<String, Challenge> challenges = new HashMap<>();
  private final Map<String, Proof> proofs = new HashMap<>();
  private final Map<String, Window> windows = new HashMap<>();

  private record Challenge(String username, String source, int x, long issuedAt) {}

  private record Proof(String username, String source, long expiresAt) {}

  private record Window(int count, long expiresAt) {}

  public record Puzzle(
      String challengeId,
      String background,
      String piece,
      int width,
      int height,
      int pieceSize,
      int y,
      int expiresIn) {}

  public record Verification(String captchaToken, int expiresIn) {}

  public SlideCaptchaService() {
    this(new SecureRandom(), Clock.systemUTC());
  }

  // 包级注入只用于单元测试时间与随机数，不提供任何 HTTP 测试开关或固定答案。
  SlideCaptchaService(SecureRandom random, Clock clock) {
    this.random = random;
    this.clock = clock;
  }

  private void prune(long now) {
    challenges.values().removeIf(c -> now - c.issuedAt() >= CHALLENGE_TTL);
    proofs.values().removeIf(p -> now >= p.expiresAt());
    windows.values().removeIf(w -> now >= w.expiresAt());
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
    Window old = windows.get(source);
    if (challenges.size() >= CAPACITY
        || proofs.size() >= CAPACITY
        || windows.size() >= CAPACITY
        || (old != null && old.count() >= PER_SOURCE_MINUTE))
      throw new BusinessException("验证请求过于频繁，请稍后再试");
    windows.put(
        source,
        new Window(
            old == null ? 1 : old.count() + 1, old == null ? now + 60_000 : old.expiresAt()));
    // 同来源/同账号换图即废弃旧题，控制刷新产生的存量，也避免多个有效答案并存。
    challenges.values().removeIf(c -> c.username().equals(username) && c.source().equals(source));
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
    Challenge c = challenges.remove(id);
    if (c == null
        || !c.username().equals(username)
        || !c.source().equals(source)
        || x < 0
        || x > WIDTH - SIZE
        || Math.abs(x - c.x()) > 4
        || elapsedMs < 300
        || elapsedMs > CHALLENGE_TTL
        || now - c.issuedAt() < elapsedMs - 150
        || now - c.issuedAt() < 300) throw new BusinessException(INVALID);
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
    Graphics2D g = background.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setPaint(
        new GradientPaint(0, 0, new Color(225, 235, 242), WIDTH, HEIGHT, new Color(147, 176, 188)));
    g.fillRect(0, 0, WIDTH, HEIGHT);
    for (int i = 0; i < 38; i++) {
      g.setColor(
          new Color(
              70 + random.nextInt(120), 100 + random.nextInt(110), 120 + random.nextInt(100), 120));
      int px = random.nextInt(WIDTH), py = random.nextInt(HEIGHT), size = 16 + random.nextInt(64);
      if (i % 2 == 0) g.fillOval(px - size / 2, py - size / 2, size, size);
      else g.fillRoundRect(px - size / 2, py - size / 2, size, size / 2, 6, 6);
    }
    Area shape = new Area(new RoundRectangle2D.Double(5, 10, 38, 33, 5, 5));
    shape.add(new Area(new Ellipse2D.Double(17, 2, 14, 16)));
    shape.add(new Area(new Ellipse2D.Double(35, 20, 12, 14)));
    shape.subtract(new Area(new Ellipse2D.Double(0, 20, 13, 14)));
    BufferedImage piece = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
    Graphics2D p = piece.createGraphics();
    p.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    p.setClip(shape);
    p.drawImage(background, -x, -y, null);
    p.setClip(null);
    p.setColor(Color.WHITE);
    p.setStroke(new BasicStroke(1.5f));
    p.draw(shape);
    p.dispose();
    Shape gap = AffineTransform.getTranslateInstance(x, y).createTransformedShape(shape);
    g.setColor(new Color(20, 30, 40, 150));
    g.fill(gap);
    g.setColor(new Color(255, 255, 255, 210));
    g.setStroke(new BasicStroke(1.5f));
    g.draw(gap);
    g.dispose();
    return new String[] {png(background), png(piece)};
  }

  private static String png(BufferedImage image) {
    try {
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      ImageIO.write(image, "png", bytes);
      return "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray());
    } catch (IOException e) {
      throw new IllegalStateException("无法生成登录验证图片", e);
    }
  }
}
