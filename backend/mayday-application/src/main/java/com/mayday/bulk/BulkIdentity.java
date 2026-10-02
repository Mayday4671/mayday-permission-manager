package com.mayday.bulk;

import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.TreeMap;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/** 作业权限快照只保存不可逆指纹；范围、角色状态或字段权限变化后必须重新生成导出。 */
@Component
@RequiredArgsConstructor
public class BulkIdentity {
  private final AccessPolicy access;
  private final PasswordEncoder fingerprints;

  /** 对有效角色、字段权限、范围和部门树作稳定指纹，下载旧结果时必须再次一致。 */
  public String signature() {
    SysUser user = access.current();
    StringBuilder value =
        new StringBuilder()
            .append(user.getId())
            .append('|')
            .append(user.isEnabled())
            .append('|')
            .append(user.getDepartmentId());
    value.append('|').append(access.permissions().stream().sorted().toList());
    user.getRoles().stream()
        .sorted(java.util.Comparator.comparing(SysRole::getId))
        .forEach(
            role -> {
              value
                  .append('|')
                  .append(role.getId())
                  .append(':')
                  .append(role.isEnabled())
                  .append(':')
                  .append(role.getCode());
              value.append(':').append(new TreeMap<>(role.getDataScopes()));
              value
                  .append(':')
                  .append(
                      role.getScopeDepartments().stream()
                          .map(grant -> grant.getResource() + "=" + grant.getDepartmentId())
                          .sorted()
                          .toList());
            });
    value.append('|').append(access.departments("DEPARTMENT_TREE").stream().sorted().toList());
    return digest(value.toString().getBytes(StandardCharsets.UTF_8));
  }

  /** 文件包含初始密码，先在内存压成固定长度，再通过带盐 BCrypt 保存慢校验值； 不持久化可供高速猜测密码的裸 SHA-256 摘要，也不把该校验值用于账号登录。 */
  public String encodeInput(byte[] bytes) {
    return fingerprints.encode(digest(bytes));
  }

  /** 重试文件需通过原带盐慢哈希比对，同一幂等键不能用于内容不同的提交。 */
  public boolean matchesInput(byte[] bytes, String encoded) {
    return encoded != null && fingerprints.matches(digest(bytes), encoded);
  }

  /** SHA-256 用于非凭据授权指纹；输入文件的结果只能在内存传给带盐慢哈希，不能直接落库。 */
  public static String digest(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("运行环境缺少 SHA-256", exception);
    }
  }
}
