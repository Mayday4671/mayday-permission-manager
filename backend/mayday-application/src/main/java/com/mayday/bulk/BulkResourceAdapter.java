package com.mayday.bulk;

import java.util.List;

/** 注册式业务扩展点。每个业务适配器声明固定资源键，并自行复用原有权限/数据范围/字段策略。 导入分为纯校验和事务内写入；导出按页读取，不能返回整张表或数据库实体。 */
public interface BulkResourceAdapter {
  /** 固定资源键用于服务端注册白名单，不能从用户输入选择 Java 类或数据库表。 */
  String resource();

  /** 已注册业务名称用于安全下载文件名，不接受外部路径或带控制字符的名称。 */
  String title();

  /** 叠加独立导入权限、原业务创建权限及创建范围限制，预览也必须检查。 */
  void requireImport();

  /** 叠加查看与导出动作授权，后台执行时使用重新加载的任务创建人身份。 */
  void requireExport();

  /** 只为当前账号允许写入的字段生成模板标题，不带默认密码或默认角色。 */
  List<String> templateHeaders();

  /** 逐行纯校验，不修改业务记录，不回传密码；行号应对应原始 CSV 数据行。 */
  BulkContracts.ImportPreview preview(CsvCodec.Document document);

  /** 必须在通用层原子事务内调用原业务用例，重新校验后写入并返回成功行数。 */
  int commit(CsvCodec.Document document);

  /** 导出字段由服务端当前读取权限决定，禁止包含密码和未授权敏感列。 */
  List<String> exportHeaders();

  /** 只读取指定一页已授权 DTO，页码从 1 开始；不得先加载全部实体再在内存过滤。 */
  ExportPage exportPage(BulkContracts.ExportFilter filter, int page);

  /** 适配器返回字符串单元格，通用层负责转义；total 仅用来显示进度和限制导出总量。 */
  record ExportPage(List<List<String>> rows, long total) {}
}
