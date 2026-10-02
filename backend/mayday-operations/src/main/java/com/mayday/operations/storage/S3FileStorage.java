package com.mayday.operations.storage;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.time.Duration;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;

/** S3/MinIO 等兼容存储的流式适配；不签发公开地址，不向页面暴露桶名、对象键和凭据。 */
@Component
public class S3FileStorage implements FileStorage {
  private final StorageSettings settings;
  private volatile S3Client client;

  public S3FileStorage(StorageSettings settings) {
    this.settings = settings;
  }

  @Override
  public String provider() {
    return "S3";
  }

  /** 未启用对象存储时不创建客户端；配置仍保留以便读取迁移前的 S3 文件。 */
  private synchronized S3Client client() {
    if (client == null) {
      settings.validateS3();
      var builder =
          S3Client.builder()
              .region(Region.of(settings.region()))
              .credentialsProvider(
                  StaticCredentialsProvider.create(
                      AwsBasicCredentials.create(settings.accessKey(), settings.secretKey())))
              .httpClientBuilder(
                  UrlConnectionHttpClient.builder()
                      .connectionTimeout(Duration.ofSeconds(5))
                      .socketTimeout(Duration.ofSeconds(30)))
              .overrideConfiguration(
                  configuration ->
                      configuration
                          .apiCallTimeout(Duration.ofSeconds(45))
                          .apiCallAttemptTimeout(Duration.ofSeconds(35)))
              .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build());
      if (!settings.endpoint().isBlank()) builder.endpointOverride(URI.create(settings.endpoint()));
      client = builder.build();
    }
    return client;
  }

  @Override
  public void write(String key, InputStream content, long length, String contentType)
      throws IOException {
    StorageKeys.validate(key);
    try {
      client()
          .putObject(
              request -> request.bucket(settings.bucket()).key(key).contentType(contentType),
              RequestBody.fromInputStream(content, length));
    } catch (SdkException | IllegalArgumentException exception) {
      // 不把 SDK 的请求 URL、签名和远端正文带入业务异常或审计。
      throw new IOException("对象存储写入失败，请检查部署配置或稍后重试");
    }
  }

  @Override
  public InputStream open(String key) throws IOException {
    StorageKeys.validate(key);
    try {
      return client().getObject(request -> request.bucket(settings.bucket()).key(key));
    } catch (SdkException | IllegalArgumentException exception) {
      throw new IOException("对象存储读取失败，请检查部署配置或稍后重试");
    }
  }

  @Override
  public void delete(String key) throws IOException {
    StorageKeys.validate(key);
    try {
      client().deleteObject(request -> request.bucket(settings.bucket()).key(key));
    } catch (SdkException | IllegalArgumentException exception) {
      throw new IOException("对象存储清理失败，请检查部署配置或稍后重试");
    }
  }

  /** 应用停止时释放已创建的 SDK 客户端；未使用 S3 的部署不会为关闭操作新建连接。 */
  @PreDestroy
  public synchronized void close() {
    if (client != null) client.close();
  }
}
