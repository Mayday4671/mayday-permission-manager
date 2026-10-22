package com.mayday.telegram;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 指向一个已完整写入共享存储的 HLS 清单或分片。客户端只见到安全文件名和接口地址， 绝不接收存储键、对象存储地址或服务器文件系统路径。
 */
@Getter
@Setter
@Table(value = "biz_telegram_video_preview_asset", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class TelegramVideoPreviewAsset extends BaseEntity
{
    /** 资源所属预览任务；只在任务达到 READY 时允许通过业务接口访问。 */
    private Long previewId;

    /** 服务端生成的主播放清单或分片名称，不使用用户输入作为路径。 */
    private String assetName;

    /** 由服务端白名单确定的 MIME，不采用归档文件中的任意类型。 */
    private String contentType;

    /** 持久化对象存储提供方标识。 */
    private String storageProvider;

    /** 服务端随机生成的对象键。 */
    private String storageKey;

    /** 完整上传后的分片/清单长度，响应时用于校验存储完整性。 */
    private Long actualSize;
}
