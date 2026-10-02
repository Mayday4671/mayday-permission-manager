package com.mayday.crawler;

import com.mayday.common.BusinessException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/** 不相信扩展名和远端 MIME；只接受固定栅格图片签名，SVG/HTML 不能作为图片入库执行。 */
public final class ImageBytes {
  private ImageBytes() {}

  public static String type(byte[] b) {
    if (b.length < 12 || b.length > 8 * 1024 * 1024) throw new BusinessException("图片为空或超过 8 MB");
    if ((b[0] & 255) == 137
        && b[1] == 80
        && b[2] == 78
        && b[3] == 71
        && b[4] == 13
        && b[5] == 10
        && b[6] == 26
        && b[7] == 10) return "png";
    if ((b[0] & 255) == 255 && (b[1] & 255) == 216 && (b[2] & 255) == 255) return "jpeg";
    String first = new String(b, 0, 12, StandardCharsets.ISO_8859_1);
    if (first.startsWith("GIF87a") || first.startsWith("GIF89a")) return "gif";
    if (first.startsWith("RIFF") && first.substring(8).equals("WEBP")) return "webp";
    throw new BusinessException("只支持 PNG、JPEG、GIF、WebP 图片，网站可能返回了验证页");
  }

  public static String hash(byte[] data) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public static String hash(String text) {
    return hash(text.getBytes(StandardCharsets.UTF_8));
  }
}
