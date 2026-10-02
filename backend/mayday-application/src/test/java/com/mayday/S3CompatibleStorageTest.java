package com.mayday;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mayday.operations.storage.S3FileStorage;
import com.mayday.operations.storage.StorageKeys;
import com.mayday.operations.storage.StorageSettings;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.S3Exception;

/**
 * 对临时本机 MinIO 的实际 SDK 验收，不加载 Spring、不使用业务数据库，也不操作部署中的桶。 根验收程序设置
 * MAYDAY_TEST_S3_ENDPOINT、MAYDAY_TEST_S3_ACCESS_KEY、MAYDAY_TEST_S3_SECRET_KEY 后执行；
 * 未提供端点时跳过，端点不是本机或凭据缺失时明确失败，不误连接真实云服务。
 */
@EnabledIfEnvironmentVariable(named = "MAYDAY_TEST_S3_ENDPOINT", matches = "http://.*")
class S3CompatibleStorageTest {
  @Test
  void realCompatibleBucketSupportsStreamWriteReadAndIdempotentCleanup() throws IOException {
    URI endpoint = URI.create(System.getenv("MAYDAY_TEST_S3_ENDPOINT"));
    assertEquals("http", endpoint.getScheme(), "临时验收端点须使用本机 HTTP 服务");
    assertTrue(
        Set.of("127.0.0.1", "localhost", "::1").contains(endpoint.getHost()), "禁止验收程序写入远程对象存储");
    String accessKey = System.getenv("MAYDAY_TEST_S3_ACCESS_KEY");
    String secretKey = System.getenv("MAYDAY_TEST_S3_SECRET_KEY");
    assertTrue(accessKey != null && !accessKey.isBlank(), "临时对象存储缺少环境访问标识");
    assertTrue(secretKey != null && !secretKey.isBlank(), "临时对象存储缺少环境密钥");
    String bucket = "mayday-file-check-" + UUID.randomUUID();
    String key = StorageKeys.create();
    String thumbnailKey = key + ".thumb.png";
    byte[] original = "真实对象存储流式正文".getBytes(StandardCharsets.UTF_8);
    byte[] thumbnail = new byte[] {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10};
    StorageSettings settings =
        new StorageSettings(
            "S3", ".", 10, endpoint.toString(), "us-east-1", bucket, accessKey, secretKey);
    S3FileStorage storage = new S3FileStorage(settings);
    // 创建的随机桶只属于这一个验收方法，清理只使用已登记的两个随机对象键。
    try (S3Client administrator =
        S3Client.builder()
            .endpointOverride(endpoint)
            .region(Region.US_EAST_1)
            .credentialsProvider(
                StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey)))
            .httpClientBuilder(
                UrlConnectionHttpClient.builder()
                    .connectionTimeout(Duration.ofSeconds(5))
                    .socketTimeout(Duration.ofSeconds(10)))
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
            .build()) {
      administrator.createBucket(request -> request.bucket(bucket));
      try {
        storage.write(key, new ByteArrayInputStream(original), original.length, "text/plain");
        storage.write(
            thumbnailKey, new ByteArrayInputStream(thumbnail), thumbnail.length, "image/png");
        try (var content = storage.open(key)) {
          assertArrayEquals(original, content.readAllBytes());
        }
        try (var content = storage.open(thumbnailKey)) {
          assertArrayEquals(thumbnail, content.readAllBytes());
        }
        var stored = administrator.headObject(request -> request.bucket(bucket).key(key));
        assertEquals((long) original.length, stored.contentLength());
        assertEquals("text/plain", stored.contentType());
        storage.delete(thumbnailKey);
        storage.delete(key);
        storage.delete(key);
        S3Exception absent =
            assertThrows(
                S3Exception.class,
                () -> administrator.headObject(request -> request.bucket(bucket).key(key)));
        assertEquals(404, absent.statusCode(), "删除成功后对象须实际不存在");
        assertThrows(IOException.class, () -> storage.open(key));
      } finally {
        // 即便中途断言失败，也只清理本方法创建的对象；不列举或清空其他业务对象。
        try {
          storage.delete(thumbnailKey);
          storage.delete(key);
          administrator.deleteBucket(request -> request.bucket(bucket));
        } finally {
          storage.close();
        }
      }
    }
  }
}
