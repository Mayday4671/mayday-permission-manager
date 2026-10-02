package com.mayday.operations.storage;

import com.mayday.common.BusinessException;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

/** 上传时生成最多 320 像素的 PNG 缩略图，先检查尺寸再解码，拒绝超大像素图片消耗服务器内存。 JDK 没有 WebP 解码器时保留原图预览，不伪造缩略图或引入不必要的原生依赖。 */
public final class ImageThumbnail {
  private static final long MAXIMUM_PIXELS = 20_000_000L;

  private ImageThumbnail() {}

  /** 解码前限制像素数并降采样生成最长三百二十像素 PNG；无 WebP 解码器时由原图降级展示。 */
  public static byte[] create(InputStream input, String contentType) throws IOException {
    if ("image/webp".equals(contentType)) return null;
    try (ImageInputStream imageStream = ImageIO.createImageInputStream(input)) {
      var readers = ImageIO.getImageReaders(imageStream);
      if (!readers.hasNext()) throw new BusinessException("图片格式无效");
      ImageReader reader = readers.next();
      try {
        reader.setInput(imageStream, true, true);
        int width = reader.getWidth(0);
        int height = reader.getHeight(0);
        if (width <= 0 || height <= 0 || (long) width * height > MAXIMUM_PIXELS)
          throw new BusinessException("图片像素总数不能超过 2000 万");
        // 在解码阶段抽样，缩略图生成不需要将完整大图载入堆内存。
        int sampling = Math.max(1, Math.min(width, height) / 640);
        var parameters = reader.getDefaultReadParam();
        parameters.setSourceSubsampling(sampling, sampling, 0, 0);
        BufferedImage source = reader.read(0, parameters);
        double scale = Math.min(1d, 320d / Math.max(source.getWidth(), source.getHeight()));
        BufferedImage thumbnail =
            new BufferedImage(
                Math.max(1, (int) (source.getWidth() * scale)),
                Math.max(1, (int) (source.getHeight() * scale)),
                BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = thumbnail.createGraphics();
        try {
          graphics.setRenderingHint(
              RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
          graphics.drawImage(source, 0, 0, thumbnail.getWidth(), thumbnail.getHeight(), null);
        } finally {
          graphics.dispose();
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageIO.write(thumbnail, "png", output);
        return output.toByteArray();
      } finally {
        reader.dispose();
      }
    }
  }
}
