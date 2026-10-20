package com.mayday.crawler;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 持久队列同时是结果与失败记录；同任务相同类型/URL 唯一，重启不重新下载已完成文件。 */
@Getter
@Setter
@Table(value = "crawl_item", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class CrawlItem extends BaseEntity
{
    private Long taskId;

    private String kind;

    private String status = "QUEUED";

    private String url;

    @JsonIgnore
    private String urlHash;

    /** 当前分页组的首次页面地址；同一文章所有图片分页使用相同 rootUrl 归档。 */
    private String rootUrl;

    private String sourceUrl;

    private String title;

    /** 页组内从 0 开始的页序号，图片条目不依赖此字段进行展示排序。 */
    private int ordinal;

    private int attempts;

    /** 仅 SUCCESS/DUPLICATE 记录关联正文文件，重复图片复用首次成功保存的文件 ID。 */
    private Long fileId;

    private String digest;

    private long bytes;

    private String error;

    @JsonIgnore
    private Long articleId;

    @JsonIgnore
    private String articleBody;

    @JsonIgnore
    private boolean bodyTruncated;
}
