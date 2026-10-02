package com.mayday.crawler;

import java.net.URI;

/** 可注入的网络边界，测试使用固定响应，生产实现始终执行公网与重定向检查。 */
public interface WebFetcher {
  /** 最终审核地址、媒体类型和有界正文；解析器不直接联网，便于用固定响应做确定性验证。 */
  record Response(URI url, String contentType, byte[] body) {}

  Response fetch(String url, CrawlRules rules, boolean image) throws Exception;
}
