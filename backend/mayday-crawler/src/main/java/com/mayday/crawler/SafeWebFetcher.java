package com.mayday.crawler;

import com.mayday.common.BusinessException;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import org.apache.hc.client5.http.*;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.*;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.util.Timeout;
import org.springframework.stereotype.Component;

/**
 * 不接受自定义 Cookie、认证头或代理。解析器返回的已审核 IP 直接用于 socket 建连，避免校验后重新解析的 DNS 重绑定。
 * 自动跳转、自动重试和解压关闭；每跳独立校验，响应有字节上限；HTTP 预算 25 秒，DNS 单次上限 8 秒。
 */
@Component
public class SafeWebFetcher implements WebFetcher {
  private static final ScheduledExecutorService DEADLINES =
      Executors.newSingleThreadScheduledExecutor(
          r -> {
            Thread t = new Thread(r, "crawler-deadline");
            t.setDaemon(true);
            return t;
          });
  // JDK DNS 解析不响应 HTTP 取消。使用有界线程池与独立超时，慢 DNS 不会持续堆积线程或阻塞业务调度。
  private static final ExecutorService DNS =
      new ThreadPoolExecutor(
          2,
          2,
          0,
          TimeUnit.SECONDS,
          new ArrayBlockingQueue<>(2),
          r -> {
            Thread t = new Thread(r, "crawler-dns");
            t.setDaemon(true);
            return t;
          },
          new ThreadPoolExecutor.AbortPolicy());

  public static InetAddress[] resolvePublic(String host) throws UnknownHostException {
    Future<InetAddress[]> lookup = null;
    InetAddress[] addresses;
    try {
      lookup = DNS.submit(() -> InetAddress.getAllByName(host));
      addresses = lookup.get(8, TimeUnit.SECONDS);
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      throw new UnknownHostException("域名解析失败或超时");
    } finally {
      if (lookup != null && !lookup.isDone()) lookup.cancel(true);
    }
    if (addresses.length == 0) throw new UnknownHostException("域名没有可用地址");
    for (InetAddress address : addresses)
      if (!WebAddress.publicIp(address)) throw new UnknownHostException("禁止访问非公网地址");
    return addresses;
  }

  @Override
  public Response fetch(String start, CrawlRules rules, boolean image) throws Exception {
    URI url = WebAddress.allowed(start, rules, image);
    var resolver =
        new DnsResolver() {
          public InetAddress[] resolve(String host) throws UnknownHostException {
            return resolvePublic(host);
          }

          public String resolveCanonicalHostname(String host) {
            return host;
          }
        };
    var manager =
        PoolingHttpClientConnectionManagerBuilder.create()
            .setDnsResolver(resolver)
            .setMaxConnTotal(1)
            .setMaxConnPerRoute(1)
            .setDefaultConnectionConfig(
                ConnectionConfig.custom()
                    .setConnectTimeout(Timeout.ofSeconds(8))
                    .setSocketTimeout(Timeout.ofSeconds(8))
                    .build())
            .build();
    try (var client =
        HttpClients.custom()
            .setConnectionManager(manager)
            .disableRedirectHandling()
            .disableAutomaticRetries()
            .disableCookieManagement()
            .disableContentCompression()
            .setUserAgent("MaydayImageCollector/1.0")
            .setDefaultRequestConfig(
                RequestConfig.custom().setResponseTimeout(Timeout.ofSeconds(8)).build())
            .build()) {
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25);
      for (int hop = 0; hop < 4; hop++) {
        // 即使 URI 是 IP 字面量（客户端可能跳过 DNS resolver），也必须执行同样的公网检查。
        resolvePublic(url.getHost());
        HttpGet request = new HttpGet(url);
        request.setHeader(
            "Accept",
            image ? "image/png,image/jpeg,image/webp,image/gif" : "text/html,application/json");
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) throw new BusinessException("请求超时");
        var cancel = DEADLINES.schedule(request::cancel, remaining, TimeUnit.NANOSECONDS);
        URI requested = url;
        try {
          var result =
              client.execute(
                  request,
                  response -> {
                    int status = response.getCode();
                    if (status >= 300 && status < 400) {
                      var location = response.getFirstHeader("Location");
                      if (location == null) throw new BusinessException("重定向缺少目标地址");
                      return new FetchResult(
                          WebAddress.allowed(
                              WebAddress.resolve(requested, location.getValue()), rules, image),
                          null);
                    }
                    if (status != 200) throw new BusinessException("网站返回 HTTP " + status);
                    var entity = response.getEntity();
                    if (entity == null) throw new BusinessException("网站没有返回内容");
                    int max = image ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
                    if (entity.getContentLength() > max) throw new BusinessException("响应超过大小限制");
                    byte[] bytes;
                    try (InputStream in = entity.getContent()) {
                      bytes = in.readNBytes(max + 1);
                    }
                    if (bytes.length > max) throw new BusinessException("响应超过大小限制");
                    return new FetchResult(
                        null,
                        new Response(
                            requested,
                            entity.getContentType() == null ? "" : entity.getContentType(),
                            bytes));
                  });
          if (result.response != null) return result.response;
          url = result.redirect;
        } finally {
          cancel.cancel(false);
        }
      }
    }
    throw new BusinessException("重定向次数过多");
  }

  private record FetchResult(URI redirect, Response response) {}
}
