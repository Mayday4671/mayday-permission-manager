package com.mayday.bulk;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 批量作业的最小持久化状态；导入密码不入库，导出临时文件本机生成、成功正文共享持久保存。 */
@Getter
@Setter
@Table(value = "sys_bulk_job", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class BulkJob extends BaseEntity
{

    /** 发起账号ID，取有效会话；只有本人且仍有有效权限时可查询下载 */
    private Long ownerId;

    /** 已注册的业务适配器资源名，例如users；不接受SQL、Java类名或任意接口 */
    private String resource;

    /** 作业类型：IMPORT原子导入、EXPORT异步导出 */
    private String kind = "EXPORT";

    /** 作业状态：QUEUED排队、RUNNING执行、SUCCEEDED成功、FAILED失败；进程重启中的导出明确失败 */
    private String status = "QUEUED";

    /** 已处理的数据行数，不含CSV表头；导出每批更新供页面查看进度 */
    private int processedRows;

    /** 计划处理的数据行总数，来自授权范围内查询或已校验导入行数 */
    private long totalRows;

    /** 导出查询条件的白名单JSON；不保存导入行正文、密码或原始请求体 */
    private String queryJson;

    /** 创建时授权及范围的SHA-256签名；执行和下载重新计算，撤权或范围变化拒绝旧导出 */
    private String permissionSignature;

    /** 随机生成的服务端导出临时文件键；未成功或导入作业为空，不向客户端公开 */
    private String resultKey;

    /** 原子导入的客户端随机幂等键；同账号唯一，导出通常为空，重试不能重复创建账号 */
    private String idempotencyKey;

    /** CSV内容的带盐BCrypt慢校验值；仅用于导入幂等，原文件及密码不持久化 */
    private String inputChecksum;

    /** 对客户可见的脱敏失败原因；不包含密码、SQL、凭据或服务器路径 */
    private String failure;

    /** 作业结果到期时间；过期后不可下载并清理临时正文，默认创建后24小时 */
    private LocalDateTime expiresAt;

    /** 保证 API 与内部存储字段隔离，后续存储迁移不会把服务端路径变成公共接口契约。 */
    public BulkContracts.JobView view()
    {
        return new BulkContracts.JobView(getId(), resource, BulkContracts.Kind.valueOf(kind),
                BulkContracts.Status.valueOf(status), processedRows, totalRows, failure, getCreatedAt(), expiresAt);
    }
}
