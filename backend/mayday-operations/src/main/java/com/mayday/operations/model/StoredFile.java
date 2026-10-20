package com.mayday.operations.model;

import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 文件元信息独立于存储实现；历史 MYSQL 文件不需要搬迁即可继续读取。 外部对象键从不返回客户端，所有读取仍经过业务鉴权接口。 */
@Getter
@Setter
@Table(value = "ops_file", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class StoredFile extends BaseEntity
{
    /** 去除目录部分及控制字符后的原始文件名；不能用作服务器路径 */

    private String name;
    /** 响应内容类型；普通附件统一 application/octet-stream，图片封面另做格式检查 */

    private String contentType;
    /** 文件字节数；当前上传限制为 1 字节至 10 MB */

    private long size;
    /** 上传者账号 ID，逻辑关联 sys_user.id；NULL 为旧数据，不自动视为公共文件 */

    private Long ownerId;
    /** 上传者昵称快照；展示用，不作为授权依据 */

    private String ownerName;

    /** null 表示用户的根目录；目录只改变组织方式，不改变文件的所有者权限。 */
    private Long directoryId;
    /** 正文存储适配器：MYSQL兼容旧记录、LOCAL本地持久目录、S3兼容对象存储；创建后不可由客户端改写 */

    private String storageProvider = "MYSQL";
    /** 服务端生成的正文对象键；旧MYSQL记录为空，不作为公共下载地址或返回前端 */

    @JsonIgnore
    private String storageKey;
    /** 服务端生成的安全图片缩略图键；不支持缩略图或旧文件为NULL，前端通过鉴权接口访问 */

    @JsonIgnore
    private String thumbnailKey;

    /** 回收文件保留正文，业务引用的文件禁止进入此状态。 */
    private LocalDateTime deletedAt;

    /** 永久删除先记录意图，再由可重试任务清理正文，避免数据库回滚损坏在用附件。 */
    private LocalDateTime purgeRequestedAt;
    /** 外部存储清理失败的脱敏提示；正文未成功删除时保留元信息，不向页面泄漏凭据或对象路径 */

    private String purgeError;
}
