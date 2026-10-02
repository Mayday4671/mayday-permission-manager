package com.mayday.crawler;

import org.jsoup.Jsoup;
import org.jsoup.nodes.*;
import tools.jackson.databind.JsonNode;

/**
 * 只保存纯文本：移除脚本、样式、表单及导航，保留段落换行。远端 HTML 和图片地址不会作为可执行正文返回。 每页最多 20,000
 * 字符，截断会明确标记；标题/作者/日期均限制长度，日期保留来源文本而非猜测时区。
 */
public final class ArticleExtractor {
  public record Text(
      String title, String body, String author, String publishedAt, boolean truncated) {}

  private ArticleExtractor() {}

  public static Text html(Document document, CrawlRules.ArticleRule rule) {
    var body =
        first(
            document,
            rule.content(),
            ".entry-content",
            "[itemprop=articleBody]",
            "article",
            "main");
    String title = value(first(document, rule.title(), "h1", "meta[property=og:title]", "title"));
    String author =
        value(first(document, rule.author(), "meta[name=author]", "[rel=author]", ".author"));
    String date =
        value(
            first(
                document,
                rule.publishedAt(),
                "meta[property=article:published_time]",
                "time[datetime]"));
    return text(title, body == null ? "" : plain(body.clone()), author, date);
  }

  public static Text json(JsonNode node, CrawlRules.ArticleRule rule) {
    return text(
        read(node, rule.title(), "/title"),
        plain(Jsoup.parse(read(node, rule.content(), "/content"))),
        read(node, rule.author(), "/author"),
        read(node, rule.publishedAt(), "/publishedAt"));
  }

  private static String read(JsonNode node, String path, String fallback) {
    var value = node.at(path == null || path.isBlank() ? fallback : path);
    return value.isValueNode() && !value.isNull() ? value.asText() : "";
  }

  private static Element first(Document doc, String configured, String... defaults) {
    if (configured != null && !configured.isBlank()) return doc.selectFirst(configured);
    for (String selector : defaults) {
      var element = doc.selectFirst(selector);
      if (element != null) return element;
    }
    return null;
  }

  private static String value(Element element) {
    if (element == null) return "";
    if (element.hasAttr("content")) return element.attr("content");
    if (element.hasAttr("datetime")) return element.attr("datetime");
    return element.text();
  }

  static String plain(Element element) {
    element
        .select(
            "script,style,noscript,iframe,object,embed,form,nav,header,footer,button,svg,canvas,.sharedaddy,.share-buttons,.addtoany_share_save_container,.page-links")
        .remove();
    // 人工插入换行标记，再读取 wholeText，兼容压缩 HTML 中相邻段落没有空白的情况。
    for (Element block : element.select("p,div,section,h1,h2,h3,h4,li,blockquote,pre,tr"))
      if (block.parent() != null) block.before(new TextNode("\n"));
    return element
        .wholeText()
        .replace('\u00a0', ' ')
        .replaceAll("[\\t\\x0B\\f\\r ]+", " ")
        .replaceAll(" *\\n *", "\n")
        .replaceAll("\\n{3,}", "\n\n")
        .trim();
  }

  private static Text text(String title, String body, String author, String publishedAt) {
    return new Text(
        limit(title, 200),
        limit(body, 20000),
        limit(author, 100),
        limit(publishedAt, 100),
        body.length() > 20000);
  }

  public static String limit(String value, int size) {
    if (value == null) return "";
    // 不从 UTF-16 代理对中间截断，避免 emoji 等字符变成无效 JSON/数据库字符。
    int end = Math.min(value.length(), size);
    if (end > 0 && end < value.length() && Character.isHighSurrogate(value.charAt(end - 1))) end--;
    return value.substring(0, end).trim();
  }
}
