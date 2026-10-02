package com.mayday.crawler;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mayday.common.BusinessException;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 离线网页夹具覆盖两层分页、旧站编码和恶意地址；不会依赖第三方网站的内容稳定性。 */
class PageExtractorTest {
  static CrawlRules.PageRule page(CrawlRules.Mode mode, CrawlRules.Format format, String template) {
    return new CrawlRules.PageRule(
        mode, format, "a.next", template, 1, 1, 3, "/next", "/items", "/images", "/url");
  }

  static CrawlRules rules(boolean details, CrawlRules.PageRule list, CrawlRules.PageRule detail) {
    return new CrawlRules(
        "https://example.com/list",
        details,
        list,
        detail,
        "a.detail",
        "article img",
        List.of("data-src", "srcset", "src"),
        List.of("cdn.example.com"),
        20,
        50,
        500);
  }

  static CrawlRules simple(CrawlRules.Mode mode) {
    return rules(
        false,
        page(mode, CrawlRules.Format.HTML, "{url}?page={page}"),
        page(CrawlRules.Mode.SINGLE, CrawlRules.Format.HTML, ""));
  }

  static WebFetcher.Response html(String url, String body) {
    return new WebFetcher.Response(
        URI.create(url), "text/html", body.getBytes(StandardCharsets.UTF_8));
  }

  @Test
  void nextPageIgnoresDisabledAndOffSiteLinksAndUsesLazyImages() throws Exception {
    var r =
        PageExtractor.extract(
            html(
                "https://example.com/list",
                """
                <title>图库</title><article><img data-src="/original.jpg" src="/small.jpg"><img src="/original.jpg">
                <img src="http://evil.example/a.jpg"><img src="//cdn.example.com/ok.png"></article>
                <a class="next disabled" href="/bad">下一页</a><a class="next" href="/list?page=2">下一页</a>
                """),
            simple(CrawlRules.Mode.NEXT),
            false,
            0,
            "https://example.com/list");
    assertEquals(
        List.of("https://example.com/original.jpg", "https://cdn.example.com/ok.png"), r.images());
    assertEquals(List.of("https://example.com/list?page=2"), r.pages());
    assertEquals("图库", r.title());
  }

  @Test
  void detailPaginationUsesItsOwnRootAndNeverReentersArticleLinks() throws Exception {
    var rules =
        rules(
            true,
            page(CrawlRules.Mode.NEXT, CrawlRules.Format.HTML, ""),
            page(CrawlRules.Mode.TEMPLATE, CrawlRules.Format.HTML, "{base}_{page}.html"));
    var list =
        PageExtractor.extract(
            html(
                "https://example.com/list",
                "<a class=detail href=/article/5.html>详情</a><article><img"
                    + " src=/thumb.png></article>"),
            rules,
            false,
            0,
            rules.entryUrl());
    assertEquals(List.of("https://example.com/article/5.html"), list.details());
    assertTrue(list.images().isEmpty());
    var detail =
        PageExtractor.extract(
            html(
                list.details().getFirst(),
                "<article><img src=/full.png></article><a class=detail href=/wrong>无关</a>"),
            rules,
            true,
            0,
            list.details().getFirst());
    assertEquals(List.of("https://example.com/article/5_2.html"), detail.pages());
    assertTrue(detail.details().isEmpty());
    assertEquals(List.of("https://example.com/full.png"), detail.images());
  }

  @Test
  void linkCollectionDeduplicatesAndStopsAtPageLimit() throws Exception {
    var response =
        html(
            "https://example.com/list",
            "<a class=next href=?page=2>2</a><a class=next href=?page=2#x>2</a><a class=next"
                + " href=?page=3>3</a>");
    assertEquals(
        2,
        PageExtractor.extract(
                response, simple(CrawlRules.Mode.LINKS), false, 0, "https://example.com/list")
            .pages()
            .size());
    assertTrue(
        PageExtractor.extract(
                response, simple(CrawlRules.Mode.LINKS), false, 2, "https://example.com/list")
            .pages()
            .isEmpty());
  }

  @Test
  void offsetTemplateIncrementsFromFirstPageOffset() throws Exception {
    var p =
        new CrawlRules.PageRule(
            CrawlRules.Mode.TEMPLATE,
            CrawlRules.Format.JSON,
            "",
            "{origin}/api?offset={page}",
            0,
            20,
            3,
            "",
            "",
            "/images",
            "");
    var r = rules(false, p, p);
    var out =
        PageExtractor.extract(
            new WebFetcher.Response(
                URI.create(r.entryUrl()),
                "application/json",
                "{\"images\":[\"/a.png\"]}".getBytes()),
            r,
            false,
            0,
            r.entryUrl());
    assertEquals(List.of("https://example.com/api?offset=20"), out.pages());
    assertEquals(1, out.images().size());
  }

  @Test
  void cursorPreservesReservedCharactersAndStopsOnEmptyValue() throws Exception {
    var p = page(CrawlRules.Mode.CURSOR, CrawlRules.Format.JSON, "{origin}/api?cursor={cursor}");
    var r = rules(false, p, p);
    var out =
        PageExtractor.extract(
            new WebFetcher.Response(
                URI.create(r.entryUrl()),
                "application/json",
                "{\"images\":[{\"url\":\"/a.png\"}],\"next\":\"a&b=/+\"}".getBytes()),
            r,
            false,
            0,
            r.entryUrl());
    assertEquals(List.of("https://example.com/api?cursor=a%26b%3D%2F%2B"), out.pages());
    assertTrue(
        PageExtractor.extract(
                new WebFetcher.Response(
                    URI.create(r.entryUrl()), "application/json", "{\"next\":null}".getBytes()),
                r,
                false,
                0,
                r.entryUrl())
            .pages()
            .isEmpty());
    assertEquals(
        "https://example.com/a%2Fb?x=a%26b",
        WebAddress.parse("https://EXAMPLE.com/a%2Fb?x=a%26b#top").toString());
  }

  @Test
  void srcsetAndLegacyEncoding() throws Exception {
    assertEquals("/large.webp", PageExtractor.largestSource("/small.webp 320w, /large.webp 1280w"));
    var response =
        new WebFetcher.Response(
            URI.create("https://example.com/list"),
            "text/html",
            "<meta charset=gbk><title>图片分页</title>"
                .getBytes(java.nio.charset.Charset.forName("GBK")));
    assertEquals(
        "图片分页",
        PageExtractor.extract(
                response, simple(CrawlRules.Mode.SINGLE), false, 0, "https://example.com/list")
            .title());
  }

  @Test
  void rejectsPrivateSpecialAndAmbiguousAddresses() throws Exception {
    for (String ip :
        List.of(
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "198.18.0.1",
            "192.0.2.1",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
            "2001::1",
            "2002::1")) assertFalse(WebAddress.publicIp(InetAddress.getByName(ip)), ip);
    assertTrue(WebAddress.publicIp(InetAddress.getByName("8.8.8.8")));
    assertTrue(WebAddress.publicIp(InetAddress.getByName("2606:4700:4700::1111")));
    assertTrue(WebAddress.publicIp(InetAddress.getByName("2001:4860:4860::8888")));
    assertTrue(WebAddress.publicIp(InetAddress.getByName("192.2.1.1")));
    for (String url :
        List.of(
            "file:///etc/passwd",
            "http://localhost/x",
            "https://a.example:8080/",
            "https://user:secret@example.com/",
            "https://example.com\\@127.0.0.1/"))
      assertThrows(BusinessException.class, () -> WebAddress.parse(url));
    assertThrows(UnknownHostException.class, () -> SafeWebFetcher.resolvePublic("127.1"));
    assertFalse(WebAddress.publicIp(InetAddress.getByName("3fff::1")));
    assertThrows(UnknownHostException.class, () -> SafeWebFetcher.resolvePublic("127.0.0.1"));
    assertThrows(
        BusinessException.class,
        () -> WebAddress.allowed("https://other.example/", simple(CrawlRules.Mode.SINGLE), false));
    assertThrows(
        BusinessException.class,
        () ->
            WebAddress.allowed(
                "https://cdn.example.com/page", simple(CrawlRules.Mode.SINGLE), false));
  }

  @Test
  void rejectsScriptAndOversizedImagePayloadsAndMalformedRules() {
    assertThrows(
        BusinessException.class, () -> ImageBytes.type("<svg onload='alert(1)'></svg>".getBytes()));
    assertThrows(BusinessException.class, () -> ImageBytes.type("<html>captcha</html>".getBytes()));
    assertThrows(BusinessException.class, () -> ImageBytes.type(new byte[8 * 1024 * 1024 + 1]));
    assertThrows(
        BusinessException.class,
        () ->
            rules(
                    false,
                    page(CrawlRules.Mode.CURSOR, CrawlRules.Format.HTML, "{cursor}"),
                    page(CrawlRules.Mode.SINGLE, CrawlRules.Format.HTML, ""))
                .validate());
    assertDoesNotThrow(() -> simple(CrawlRules.Mode.NEXT).validate());
    // 关闭进入详情后，不应被之前未填完的详情分页字段阻止保存或运行。
    assertDoesNotThrow(
        () ->
            rules(
                    false,
                    page(CrawlRules.Mode.SINGLE, CrawlRules.Format.HTML, ""),
                    page(CrawlRules.Mode.CURSOR, CrawlRules.Format.HTML, ""))
                .validate());
  }

  @Test
  void articleMetadataParagraphsAndActiveContentAreSeparatedFromImages() throws Exception {
    var r =
        PageExtractor.extract(
            html(
                "https://example.com/list",
                """
                <title>网页标题</title><meta name=author content=来源作者><h1>文章标题</h1><time datetime=2026-09-22></time>
                <nav>顶部菜单</nav><div class=entry-content><p>第一段</p><p>第二段<br>换行</p>
                <script>alert('secret')</script><iframe src=https://evil.example></iframe><form>表单</form><nav>正文导航</nav>
                <div class=addtoany_share_save_container><div class=addtoany_header>分享带来好运：</div></div></div>
                """),
            simple(CrawlRules.Mode.SINGLE),
            false,
            0,
            "https://example.com/list");
    assertEquals("文章标题", r.article().title());
    assertEquals("来源作者", r.article().author());
    assertEquals("2026-09-22", r.article().publishedAt());
    assertEquals("第一段\n第二段\n换行", r.article().body());
    assertFalse(r.article().truncated());
    var listRules =
        rules(
            true,
            page(CrawlRules.Mode.SINGLE, CrawlRules.Format.HTML, ""),
            page(CrawlRules.Mode.SINGLE, CrawlRules.Format.HTML, ""));
    assertNull(
        PageExtractor.extract(
                html(listRules.entryUrl(), "<h1>列表</h1><article>不要作为文章</article>"),
                listRules,
                false,
                0,
                listRules.entryUrl())
            .article());
  }

  @Test
  void customArticlePathsAndJsonContentAreBoundedAndDoNotExecuteHtml() throws Exception {
    var base = simple(CrawlRules.Mode.SINGLE);
    var configured =
        new CrawlRules(
            base.entryUrl(),
            false,
            base.list(),
            base.detail(),
            "a",
            "img",
            List.of("src"),
            List.of(),
            1,
            1,
            500,
            new CrawlRules.ArticleRule(true, ".headline", ".body", ".byline", ".published"));
    var result =
        PageExtractor.extract(
            html(
                base.entryUrl(),
                "<h1>无关</h1><div class=headline>定制标题</div><div class=body>"
                    + "字".repeat(20001)
                    + "</div>"),
            configured,
            false,
            0,
            base.entryUrl());
    assertEquals("定制标题", result.article().title());
    assertEquals(20000, result.article().body().length());
    assertTrue(result.article().truncated());
    var p = page(CrawlRules.Mode.SINGLE, CrawlRules.Format.JSON, "");
    var jsonRules =
        new CrawlRules(
            base.entryUrl(),
            false,
            p,
            p,
            "a",
            "img",
            List.of("src"),
            List.of(),
            1,
            1,
            500,
            new CrawlRules.ArticleRule(true, "/data/title", "/data/body", "", ""));
    var json =
        new WebFetcher.Response(
            URI.create(base.entryUrl()),
            "application/json",
            "{\"data\":{\"title\":\"标题\",\"body\":\"<p>正文</p><script>恶意</script>\"}}"
                .getBytes(StandardCharsets.UTF_8));
    assertEquals(
        "正文", PageExtractor.extract(json, jsonRules, false, 0, base.entryUrl()).article().body());
    assertTrue(CrawlRules.parse(base.json()).articleRule().enabled(), "旧规则 JSON 兼容默认自动识别");
  }
}
