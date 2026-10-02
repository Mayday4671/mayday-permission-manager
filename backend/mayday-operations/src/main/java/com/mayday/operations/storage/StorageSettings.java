package com.mayday.operations.storage;

import java.net.URI;
import java.nio.file.Path;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 部署级存储配置。对象存储凭据只读取环境变量，既不保存进业务数据库，也不序列化到页面。 修改模式只影响新上传；旧文件继续依据其元信息选择存储实现。 */
@Component
public class StorageSettings {
  private final String provider;
  private final Path localRoot;
  private final long maximumBytes;
  private final String endpoint;
  private final String region;
  private final String bucket;
  private final String accessKey;
  private final String secretKey;

  public StorageSettings(
      @Value("${MAYDAY_STORAGE_MODE:LOCAL}") String provider,
      @Value("${MAYDAY_STORAGE_LOCAL_ROOT:./data/files}") String localRoot,
      @Value("${MAYDAY_STORAGE_MAX_MB:10}") int maximumMegabytes,
      @Value("${MAYDAY_STORAGE_S3_ENDPOINT:}") String endpoint,
      @Value("${MAYDAY_STORAGE_S3_REGION:us-east-1}") String region,
      @Value("${MAYDAY_STORAGE_S3_BUCKET:}") String bucket,
      @Value("${MAYDAY_STORAGE_S3_ACCESS_KEY:}") String accessKey,
      @Value("${MAYDAY_STORAGE_S3_SECRET_KEY:}") String secretKey) {
    this.provider = provider.strip().toUpperCase(Locale.ROOT);
    if (!this.provider.equals("LOCAL") && !this.provider.equals("S3"))
      throw new IllegalArgumentException("MAYDAY_STORAGE_MODE 只支持 LOCAL 或 S3");
    if (maximumMegabytes < 1 || maximumMegabytes > 100)
      throw new IllegalArgumentException("MAYDAY_STORAGE_MAX_MB 须在 1 到 100 之间");
    this.localRoot = Path.of(localRoot).toAbsolutePath().normalize();
    this.maximumBytes = maximumMegabytes * 1024L * 1024L;
    this.endpoint = endpoint.strip();
    this.region = region.strip();
    this.bucket = bucket.strip();
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    if (this.provider.equals("S3")) validateS3();
  }

  /** 返回新上传使用的存储模式；已有文件仍依据自身持久化的提供方读取。 */
  public String provider() {
    return provider;
  }

  /** 返回服务端规范化存储根路径，仅由本地实现使用，不加入客户端响应。 */
  public Path localRoot() {
    return localRoot;
  }

  /** 返回后端真正执行的字节限额，前端即使绕过控件校验也无法扩大上传上限。 */
  public long maximumBytes() {
    return maximumBytes;
  }

  /** 返回部署指定的存储桶，仅用于 SDK 请求，业务表不保存桶凭据或公开地址。 */
  public String bucket() {
    return bucket;
  }

  /** 返回 SDK 请求签名区域，兼容对象存储服务也须提供非空区域。 */
  public String region() {
    return region;
  }

  /** 返回已校验的服务端对象存储端点；空值表示使用 SDK 的标准区域端点。 */
  public String endpoint() {
    return endpoint;
  }

  /** 仅向存储 SDK 提供环境中的访问标识，本配置对象不得作为接口响应序列化。 */
  public String accessKey() {
    return accessKey;
  }

  /** 仅向存储 SDK 提供环境密钥，禁止把该值写入日志、数据库或页面配置。 */
  public String secretKey() {
    return secretKey;
  }

  /** 切换模式后读取旧 S3 文件时也重新校验，缺少凭据须明确失败而不能写入其他存储。 */
  public void validateS3() {
    if (region.isBlank() || bucket.isBlank() || accessKey.isBlank() || secretKey.isBlank())
      throw new IllegalArgumentException("S3 存储缺少区域、存储桶或环境凭据");
    if (!endpoint.isBlank()) {
      URI uri = URI.create(endpoint);
      if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
          || uri.getHost() == null
          || uri.getUserInfo() != null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))
        throw new IllegalArgumentException("S3 地址须为无凭据、无路径和查询参数的 HTTP(S) 服务地址");
    }
  }
}
