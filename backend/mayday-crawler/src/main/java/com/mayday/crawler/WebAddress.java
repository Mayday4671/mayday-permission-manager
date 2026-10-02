package com.mayday.crawler;

import com.mayday.common.BusinessException;
import java.net.IDN;
import java.net.InetAddress;
import java.net.URI;
import java.util.Locale;
import java.util.Set;

/** 所有入口、翻页、详情、图片及重定向共用 URL 边界；DNS 校验还必须在实际建连阶段再次执行。 */
public final class WebAddress {
  private WebAddress() {}

  /** 规范化公网 HTTP(S) 地址，拒绝内网主机、非默认端口及账号信息；保留原始查询转义。 */
  public static URI parse(String value) {
    try {
      if (value == null
          || value.length() > 2000
          || value.contains("\\")
          || value.chars().anyMatch(c -> c < 32)) throw new Exception();
      URI u = new URI(value.trim()).normalize();
      if (!Set.of("http", "https").contains(u.getScheme())
          || u.getHost() == null
          || u.getUserInfo() != null
          || u.getPort() != -1 && u.getPort() != (u.getScheme().equals("https") ? 443 : 80))
        throw new Exception();
      String host = host(u.getHost());
      if (host.equals("localhost")
          || host.endsWith(".localhost")
          || host.endsWith(".local")
          || !host.contains(".")) throw new Exception();
      // 保留原始转义；先解码再重建会把游标中的 %26 变成参数分隔符、%2F 变成路径分隔符。
      return new URI(
          u.getScheme()
              + "://"
              + host
              + (u.getRawPath().isEmpty() ? "/" : u.getRawPath())
              + (u.getRawQuery() == null ? "" : "?" + u.getRawQuery()));
    } catch (Exception e) {
      throw new BusinessException("仅支持不含账号信息的公网 HTTP/HTTPS 地址及默认端口");
    }
  }

  /** 允许域名须准确匹配，国际域名转换为 ASCII；不支持通配符、协议、端口及路径。 */
  public static String host(String raw) {
    if (raw == null
        || raw.isBlank()
        || raw.contains(":")
        || raw.contains("/")
        || raw.contains("*")
        || raw.endsWith(".")) throw new BusinessException("请输入准确域名，不包含协议、路径、通配符或端口");
    try {
      return IDN.toASCII(raw.trim().toLowerCase(Locale.ROOT), IDN.USE_STD3_ASCII_RULES);
    } catch (Exception e) {
      throw new BusinessException("域名格式不正确");
    }
  }

  /** 列表、详情和分页只能在入口站内，图片可额外使用任务明确登记的图片域名。 */
  public static URI allowed(String value, CrawlRules rules, boolean image) {
    URI url = parse(value);
    String origin = parse(rules.entryUrl()).getHost();
    if (!url.getHost().equals(origin)
        && (!image
            || rules.imageHosts().stream().map(WebAddress::host).noneMatch(url.getHost()::equals)))
      throw new BusinessException(image ? "图片地址不在允许域名内" : "分页和详情必须在入口网站内");
    return url;
  }

  /** 校验实际解析的每个地址，拒绝本机、私有、保留和协议特殊网段，供建连阶段防 SSRF 使用。 */
  public static boolean publicIp(InetAddress address) {
    if (address.isAnyLocalAddress()
        || address.isLoopbackAddress()
        || address.isLinkLocalAddress()
        || address.isSiteLocalAddress()
        || address.isMulticastAddress()) return false;
    byte[] b = address.getAddress();
    if (b.length == 16) {
      // 仅放行 IPv6 全球单播 2000::/3，拒绝过渡、文档和协议特殊用途段。
      int secondWord = ((b[2] & 255) << 8) | (b[3] & 255);
      boolean protocolOrDocumentation =
          (b[0] & 255) == 0x20
              && (b[1] & 255) == 1
              && (secondWord <= 0x01ff || secondWord == 0x0db8);
      boolean documentation2024 =
          (b[0] & 255) == 0x3f && (b[1] & 255) == 0xff && (b[2] & 0xf0) == 0;
      return (b[0] & 0xe0) == 0x20
          && !protocolOrDocumentation
          && !documentation2024
          && !((b[0] & 255) == 0x20 && (b[1] & 255) == 2);
    }
    int a = b[0] & 255, c = b[1] & 255, d = b[2] & 255;
    return a != 0
        && a != 10
        && a != 127
        && a < 224
        && !(a == 100 && c >= 64 && c <= 127)
        && !(a == 169 && c == 254)
        && !(a == 172 && c >= 16 && c <= 31)
        && !(a == 192 && (c == 168 || c == 0 && (d == 0 || d == 2)))
        && !(a == 192 && c == 88 && d == 99)
        && !(a == 198 && (c == 18 || c == 19 || c == 51 && d == 100))
        && !(a == 203 && c == 0 && d == 113);
  }

  /** 相对链接转换成受控绝对地址；不可用链接返回 null，不让单个网页坏链接中止整页解析。 */
  public static String resolve(URI base, String value) {
    try {
      String relative = value.trim();
      // java.net.URI 对纯查询链接会丢失最后一级路径；网页 ?page=2 应保留当前文件名。
      return parse(
              relative.startsWith("?")
                  ? base.getScheme() + "://" + base.getRawAuthority() + base.getRawPath() + relative
                  : base.resolve(relative).toString())
          .toString();
    } catch (Exception e) {
      return null;
    }
  }
}
