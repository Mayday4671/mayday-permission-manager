package com.mayday.crawler;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.mayday.common.BusinessException;
import java.util.List;
import java.util.Locale;
import org.jsoup.Jsoup;
import tools.jackson.databind.json.JsonMapper;

/** 列表和详情各自拥有分页规则；JSON 路径采用标准 JSON Pointer，禁止执行脚本或表达式。 */
public record CrawlRules(
    String entryUrl,
    boolean enterDetails,
    PageRule list,
    PageRule detail,
    String detailSelector,
    String imageSelector,
    List<String> imageAttributes,
    List<String> imageHosts,
    int maxDetails,
    int maxImages,
    int intervalMs,
    @JsonInclude(JsonInclude.Include.NON_NULL) ArticleRule article) {
  /** 空配置沿用自动识别；旧任务 JSON 可继续读取。CSS/JSON Pointer 只定位字段，不执行远端代码。 */
  public record ArticleRule(
      boolean enabled, String title, String content, String author, String publishedAt) {}

  /** 历史任务没有 article 字段时仍默认采集正文，维持旧任务的可读兼容性。 */
  public ArticleRule articleRule() {
    return article == null ? new ArticleRule(true, "", "", "", "") : article;
  }

  public CrawlRules(
      String entryUrl,
      boolean enterDetails,
      PageRule list,
      PageRule detail,
      String detailSelector,
      String imageSelector,
      List<String> imageAttributes,
      List<String> imageHosts,
      int maxDetails,
      int maxImages,
      int intervalMs) {
    this(
        entryUrl,
        enterDetails,
        list,
        detail,
        detailSelector,
        imageSelector,
        imageAttributes,
        imageHosts,
        maxDetails,
        maxImages,
        intervalMs,
        null);
  }

  /** 只支持链接、数值模板和 JSON 游标等确定性分页；不会执行任意网页脚本。 */
  public enum Mode {
    SINGLE,
    NEXT,
    LINKS,
    TEMPLATE,
    CURSOR
  }

  /** 页面解析格式，由任务显式指定，不根据服务端返回的任意正文猜测可执行内容。 */
  public enum Format {
    HTML,
    JSON
  }

  /** 每组分页的独立规则，列表与每篇详情各有计数预算。 start/step 控制模板序号，maxPages 限制请求数量，JSON 字段采用标准 Pointer；模板不会执行表达式。 */
  public record PageRule(
      Mode mode,
      Format format,
      String selector,
      String template,
      int start,
      int step,
      int maxPages,
      String nextPointer,
      String detailsPointer,
      String imagesPointer,
      String urlPointer) {}

  private static final JsonMapper JSON = JsonMapper.builder().build();

  /** 将已验证的配置保存为快照；执行后不再允许编辑，重试使用同一规则。 */
  public String json() {
    return JSON.writeValueAsString(this);
  }

  /** 读取数据库规则快照；损坏或未知字段结构须明确失败，不擅自扩宽采集域名与预算。 */
  public static CrawlRules parse(String json) {
    return JSON.readValue(json, CrawlRules.class);
  }

  /** 在预览、保存和运行前校验域名、选择器及请求预算，浏览器的输入校验不能替代此边界。 */
  public CrawlRules validate() {
    WebAddress.parse(entryUrl);
    page(list);
    if (enterDetails) page(detail);
    var a = articleRule();
    if (a.enabled())
      for (String value :
          List.of(text(a.title()), text(a.content()), text(a.author()), text(a.publishedAt()))) {
        if ((enterDetails ? detail : list).format() == Format.HTML) selector(value);
        else if (value.length() > 256 || !value.isBlank() && !value.startsWith("/"))
          throw new BusinessException("文章字段须使用 JSON Pointer 路径");
      }
    selector(detailSelector);
    selector(imageSelector);
    if (imageSelector == null || imageSelector.isBlank()) throw new BusinessException("请填写图片选择器");
    if (enterDetails
        && list.format == Format.HTML
        && (detailSelector == null || detailSelector.isBlank()))
      throw new BusinessException("进入详情页时须填写详情链接选择器");
    if (imageAttributes == null
        || imageAttributes.isEmpty()
        || imageAttributes.size() > 8
        || imageAttributes.stream()
            .anyMatch(v -> v == null || !v.matches("[a-zA-Z][a-zA-Z0-9-]{0,40}")))
      throw new BusinessException("图片属性须为 src、data-src、srcset 等属性名，最多 8 个");
    if (imageHosts == null || imageHosts.size() > 10) throw new BusinessException("图片域名最多 10 个");
    for (String host : imageHosts) WebAddress.host(host);
    if (maxDetails < 1
        || maxDetails > 200
        || maxImages < 1
        || maxImages > 500
        || intervalMs < 500
        || intervalMs > 10000)
      throw new BusinessException("详情上限 1–200，图片上限 1–500，请求间隔 500–10000 毫秒");
    return this;
  }

  private static void page(PageRule p) {
    if (p == null || p.mode == null || p.format == null) throw new BusinessException("请完整配置分页规则");
    if (p.start < 0
        || p.start > 1000000
        || p.step < 1
        || p.step > 1000
        || p.maxPages < 1
        || p.maxPages > 100) throw new BusinessException("起始值 0–1000000，步长 1–1000，单组分页上限 1–100");
    selector(p.selector);
    for (String pointer :
        List.of(
            text(p.nextPointer), text(p.detailsPointer), text(p.imagesPointer), text(p.urlPointer)))
      if (pointer.length() > 256 || !pointer.isEmpty() && !pointer.startsWith("/"))
        throw new BusinessException("JSON 路径使用 /data/items 形式的 JSON Pointer");
    if (p.mode == Mode.NEXT || p.mode == Mode.LINKS) {
      if (p.format == Format.HTML && text(p.selector).isBlank())
        throw new BusinessException("请填写分页链接选择器");
      if (p.format == Format.JSON && text(p.nextPointer).isBlank())
        throw new BusinessException("请填写下一页链接的 JSON 路径");
    }
    if (p.mode == Mode.TEMPLATE || p.mode == Mode.CURSOR) {
      if (text(p.template).length() > 2000
          || !text(p.template).contains(p.mode == Mode.CURSOR ? "{cursor}" : "{page}"))
        throw new BusinessException("分页模板必须包含 {page} 或 {cursor}");
    }
    if (p.mode == Mode.CURSOR && (p.format != Format.JSON || text(p.nextPointer).isBlank()))
      throw new BusinessException("游标分页须选择 JSON 并填写下一游标路径");
  }

  private static void selector(String value) {
    if (value == null || value.isBlank()) return;
    if (value.length() > 256
        || value.toLowerCase(Locale.ROOT).contains(":matches")
        || value.toLowerCase(Locale.ROOT).contains(":has("))
      throw new BusinessException("选择器过长或包含不支持的嵌套/正则匹配");
    try {
      Jsoup.parse("").select(value);
    } catch (Exception e) {
      throw new BusinessException("CSS 选择器格式不正确");
    }
  }

  /** 旧任务的可选定位字段允许为空，统一转为空串后再判断是否使用默认识别。 */
  public static String text(String value) {
    return value == null ? "" : value;
  }
}
