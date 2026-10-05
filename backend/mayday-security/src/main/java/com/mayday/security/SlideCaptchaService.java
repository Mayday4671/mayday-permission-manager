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
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 自托管登录拼图：答案只在服务端保存，前端只收到栅格图片，不下发目标坐标或可解码答案。 挑战、通过凭证均一次性，绑定账号和请求来源；先消费再判断，错误尝试不能反复猜同一道题。
 * 这是基础自动化滥用拦截，不代替密码限流、MFA 或专业风控。挑战及凭证保存在 MySQL 共享状态中， 多实例使用同一配额、数据库时间和原子消费；应用重启不会恢复已消费的凭证。
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
  private static final String INVALID = "验证未通过或已过期，请重新拖动滑块";
  private final SecureRandom random;
  private final Clock clock;
  private final SecurityState state;

  /** 服务端挑战答案及绑定上下文；目标横坐标只留在服务器数据库，不包含在任何公开响应。 */
  private record Challenge(String username, String source, int x, long issuedAt) {}

  /** 通过拼图后的短期一次性凭证；仍绑定用户名与来源，不能代替密码登录或跨账号使用。 */
  private record Proof(String username, String source, long expiresAt) {}

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

  /** Spring 只装配数据库共享状态，不存在生产内存回退或关闭验证码的配置入口。 */
  @Autowired
  public SlideCaptchaService(JdbcSecurityState state) {
    this(new SecureRandom(), null, state);
  }

  /** 包级时钟及状态注入只供单元测试，不提供任何 HTTP 固定答案或跳过验证入口。 */
  SlideCaptchaService(SecureRandom random, Clock clock, SecurityState state) {
    this.random = random;
    this.clock = clock;
    this.state = state;
  }

  private long now() {
    return clock == null ? state.now() : clock.millis();
  }

  private static String encode(String value) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(value.getBytes(StandardCharsets.UTF_8));
  }

  private static String decode(String value) {
    return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
  }

  private String nonce() {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  /** 不查询账号是否存在，避免挑战接口成为用户名探测入口。 */
  public synchronized Puzzle issue(String username, String source) {
    state.reserveChallenge(source);
    long now = now();
    int x = 64 + random.nextInt(WIDTH - SIZE - 80), y = 24 + random.nextInt(HEIGHT - SIZE - 40);
    String id = nonce();
    String[] images = render(x, y);
    state.challenge(
        id,
        username + "\n" + source,
        source,
        encode(username) + ":" + encode(source) + ":" + x + ":" + now,
        CHALLENGE_TTL);
    return new Puzzle(
        id, images[0], images[1], WIDTH, HEIGHT, SIZE, y, (int) (CHALLENGE_TTL / 1000));
  }

  /** 一题仅允许一次验证；时间检查在服务端执行，客户端耗时只作为附加约束。 */
  public synchronized Verification verify(
      String id, String username, String source, int x, long elapsedMs) {
    long now = now();
    String payload = state.take("CHALLENGE", id);
    String[] values = payload == null ? null : payload.split(":");
    Challenge challenge =
        values == null
            ? null
            : new Challenge(
                decode(values[0]),
                decode(values[1]),
                Integer.parseInt(values[2]),
                Long.parseLong(values[3]));
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
    String token = nonce();
    state.proof(
        token,
        username + "\n" + source,
        encode(username) + ":" + encode(source) + ":" + (now + PROOF_TTL),
        PROOF_TTL);
    return new Verification(token, (int) (PROOF_TTL / 1000));
  }

  /** 登录入口必须先消费此凭证再进行密码比较；密码错误也不会返还凭证。 */
  public synchronized void consume(String token, String username, String source) {
    String payload = state.take("PROOF", token);
    String[] values = payload == null ? null : payload.split(":");
    Proof proof =
        values == null
            ? null
            : new Proof(decode(values[0]), decode(values[1]), Long.parseLong(values[2]));
    if (proof == null
        || now() >= proof.expiresAt()
        || !proof.username().equals(username)
        || !proof.source().equals(source)) throw new BusinessException("请先完成滑动验证");
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
