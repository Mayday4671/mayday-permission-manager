package com.mayday.common;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.safety.Safelist;

/**
 * 所有业务共用的富文本持久化边界。只保留编辑器支持的排版，拒绝事件属性、CSS、链接、图片和远程嵌入。 文件走独立关联与鉴权接口，绝不通过 HTML 中的任意 URL
 * 暗中公开。前端清理只作纵深防护。
 */
public final class RichText {
  private RichText() {}

  private static final Safelist ALLOWED =
      new Safelist()
          .addTags(
              "p",
              "br",
              "strong",
              "b",
              "em",
              "i",
              "u",
              "s",
              "h2",
              "h3",
              "ul",
              "ol",
              "li",
              "blockquote");

  /** 持久化前以服务端白名单清理正文，并同时限制原文及清理后长度；空正文和超长正文按业务错误拒绝。 */
  public static String clean(String input, int limit) {
    if (input == null || input.length() > limit) throw new BusinessException("正文超出允许长度");
    String html = Jsoup.clean(input, "", ALLOWED, new Document.OutputSettings().prettyPrint(false));
    if (Jsoup.parse(html).text().isBlank()) throw new BusinessException("请输入有效正文");
    if (html.length() > limit) throw new BusinessException("正文超出允许长度");
    return html;
  }

  /** 旧纯文本接口和初始化数据必须先转义，不能把原正文中的尖括号解释为 HTML。 */
  public static String plain(String input, int limit) {
    if (input == null) throw new BusinessException("请输入有效正文");
    return clean(
        "<p>"
            + input
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\n", "<br>")
            + "</p>",
        limit);
  }
}
