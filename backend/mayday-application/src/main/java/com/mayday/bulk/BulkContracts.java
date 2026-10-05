package com.mayday.bulk;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/** 批量接口的安全响应模型：不返回密码、文件路径、权限指纹或原始后台筛选快照。 */
public final class BulkContracts {
  private BulkContracts() {}

  /** 行号对应 CSV 原始数据行（标题占第 1 行），浏览器可直接定位错误来源。 */
  @Schema(requiredProperties = {"rowNumber", "values", "errors"})
  public record ImportRow(int rowNumber, Map<String, String> values, List<String> errors) {}

  /** 预览仅校验，不写入数据库；提交时重新校验全部规则，不能把预览结果当成授权凭据。 */
  @Schema(requiredProperties = {"totalRows", "validRows", "rows"})
  public record ImportPreview(int totalRows, int validRows, List<ImportRow> rows) {}

  /** 提交采用全批原子事务，成功后返回行数；同一幂等键的网络重试不重复创建账号。 */
  @Schema(requiredProperties = {"jobId", "importedRows"})
  public record ImportResult(Long jobId, int importedRows) {}

  /** 进度只向任务创建人提供；失败说明经过脱敏，不拼接异常中的原始数据。 */
  @Schema(
      requiredProperties = {
        "id",
        "resource",
        "kind",
        "status",
        "processedRows",
        "totalRows",
        "createdAt",
        "expiresAt"
      })
  public record JobView(
      Long id,
      String resource,
      Kind kind,
      Status status,
      int processedRows,
      long totalRows,
      String failure,
      LocalDateTime createdAt,
      LocalDateTime expiresAt) {}

  /** 区分导入幂等回执与异步导出，下载动作仅适用于 EXPORT。 */
  public enum Kind {
    IMPORT,
    EXPORT
  }

  /** 异步导出覆盖排队、执行、成功、失败和取消；浏览器不能通过字段参数直接改变状态。 */
  public enum Status {
    QUEUED,
    RUNNING,
    SUCCEEDED,
    FAILED,
    CANCELLED
  }

  /** 注册适配器显式声明筛选，不接受任意属性路径、SQL、Java 类名或远程执行命令。 */
  public record ExportFilter(
      String keyword,
      @Schema(nullable = true) Boolean enabled,
      @Schema(nullable = true) Long departmentId) {}
}
