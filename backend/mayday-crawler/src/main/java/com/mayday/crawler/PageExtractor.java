package com.mayday.crawler;

import com.mayday.common.BusinessException;
import java.io.ByteArrayInputStream;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 纯解析器：不发请求。页码模板、下一页和游标对列表与每篇详情复用相同逻辑。 */
public final class PageExtractor {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  public record Links(String title, List<String> images, List<String> details, List<String> pages, ArticleExtractor.Text article) {
    public Links(String title,List<String> images,List<String> details,List<String> pages) { this(title,images,details,pages,null); }
  }
  private PageExtractor() {}
  public static Links extract(WebFetcher.Response response, CrawlRules rules, boolean detail, int ordinal, String rootUrl) throws Exception {
    var p = detail ? rules.detail() : rules.list();
    var images = new LinkedHashSet<String>(); var details = new LinkedHashSet<String>(); var pages = new LinkedHashSet<String>();
    String title = "";
    ArticleExtractor.Text article=null;
    boolean collectArticle=rules.articleRule().enabled() && (detail || !rules.enterDetails());
    JsonNode json = null;
    URI base = response.url();
    if (p.format() == CrawlRules.Format.JSON) {
      json = JSON.readTree(response.body());
      if(collectArticle) { article=ArticleExtractor.json(json,rules.articleRule());title=article.title(); }
      if (!detail && rules.enterDetails()) addJson(details, json, p.detailsPointer(), p.urlPointer(), base);
      else addJson(images, json, p.imagesPointer(), p.urlPointer(), base);
      if (p.mode() == CrawlRules.Mode.NEXT || p.mode() == CrawlRules.Mode.LINKS)
        addJson(pages, json, p.nextPointer(), "", base);
      if (p.mode() == CrawlRules.Mode.NEXT && pages.size() > 1) {
        String first = pages.iterator().next(); pages.clear(); pages.add(first);
      }
    } else {
      if (!response.contentType().toLowerCase(Locale.ROOT).contains("html")) throw new BusinessException("页面不是 HTML，请检查地址或选择 JSON 模式");
      // Jsoup 根据 BOM / meta 自动识别编码，兼容 UTF-8 与 GBK 旧站。
      Document doc = Jsoup.parse(new ByteArrayInputStream(response.body()), null, base.toString());
      title = doc.title();
      if(collectArticle) article=ArticleExtractor.html(doc,rules.articleRule());
      if (!detail && rules.enterDetails()) {
        for (Element e : doc.select(rules.detailSelector())) add(details, base, e.attr("href"));
      } else {
        for (Element e : doc.select(rules.imageSelector())) {
          for (String attribute : rules.imageAttributes()) {
            String raw = e.attr(attribute);
            if (raw.isBlank() || raw.startsWith("data:")) continue;
            // srcset 选择描述符最大的候选，避免把缩略图与原图重复入库。
            if (attribute.endsWith("srcset")) raw = largestSource(raw);
            if (add(images, base, raw)) break;
          }
        }
      }
      if (p.mode() == CrawlRules.Mode.NEXT || p.mode() == CrawlRules.Mode.LINKS) {
        for (Element e : doc.select(p.selector())) {
          if (e.hasClass("disabled") || e.hasAttr("disabled") || "true".equals(e.attr("aria-disabled"))) continue;
          add(pages, base, e.attr("href"));
          if (p.mode() == CrawlRules.Mode.NEXT && !pages.isEmpty()) break;
        }
      }
    }
    if (p.mode() == CrawlRules.Mode.TEMPLATE && ordinal + 1 < p.maxPages())
      add(pages, base, template(p.template(), URI.create(rootUrl), String.valueOf(p.start() + (ordinal + 1) * p.step()), ""));
    if (p.mode() == CrawlRules.Mode.CURSOR && ordinal + 1 < p.maxPages()) {
      JsonNode cursor = json.at(p.nextPointer());
      if (cursor.isValueNode() && !cursor.isNull() && !cursor.asText().isBlank() && cursor.asText().length() <= 1000)
        add(pages, base, template(p.template(), URI.create(rootUrl), "", URLEncoder.encode(cursor.asText(), StandardCharsets.UTF_8)));
    }
    if (p.mode() == CrawlRules.Mode.SINGLE || ordinal + 1 >= p.maxPages()) pages.clear();
    return new Links(title.length() > 200 ? title.substring(0, 200) : title,
        checked(images, rules, true), checked(details, rules, false), checked(pages, rules, false),article);
  }
  private static void addJson(Set<String> target, JsonNode root, String pointer, String urlPointer, URI base) {
    if (pointer == null || pointer.isBlank()) return;
    JsonNode selected = root.at(pointer);
    if (selected.isArray()) {
      for (JsonNode node : selected) addNode(target, node, urlPointer, base);
    } else addNode(target, selected, urlPointer, base);
  }
  private static void addNode(Set<String> target, JsonNode node, String pointer, URI base) {
    if (node.isObject() && pointer != null && !pointer.isBlank()) node = node.at(pointer);
    if (node.isString()) add(target, base, node.asText());
  }
  private static boolean add(Set<String> target, URI base, String value) {
    if (value == null || value.isBlank() || target.size() >= 1000 || value.startsWith("#")) return false;
    String resolved = WebAddress.resolve(base, value);
    if (resolved == null) return false;
    target.add(resolved); return true;
  }
  private static List<String> checked(Set<String> values, CrawlRules rules, boolean image) {
    return values.stream().filter(url -> {
      try { WebAddress.allowed(url, rules, image); return true; } catch (BusinessException e) { return false; }
    }).toList();
  }
  static String largestSource(String srcset) {
    String selected = ""; double largest = -1;
    for (String part : srcset.split(",")) {
      String[] bits = part.trim().split("\\s+"); if (bits.length == 0) continue;
      double score = 1;
      if (bits.length > 1) try { score = Double.parseDouble(bits[1].replaceAll("[wx]$", "")); } catch (NumberFormatException ignored) { continue; }
      if (score > largest) { largest = score; selected = bits[0]; }
    }
    return selected;
  }
  static String template(String template, URI root, String page, String cursor) {
    String path = root.getRawPath(), withoutQuery = root.getScheme() + "://" + root.getRawAuthority() + path;
    int dot = path.lastIndexOf('.');
    String base = dot > path.lastIndexOf('/') ? withoutQuery.substring(0, withoutQuery.length() - path.length() + dot) : withoutQuery;
    return template.replace("{url}", root.toString()).replace("{base}", base).replace("{origin}", root.getScheme() + "://" + root.getRawAuthority())
        .replace("{page}", page).replace("{cursor}", cursor);
  }
}
