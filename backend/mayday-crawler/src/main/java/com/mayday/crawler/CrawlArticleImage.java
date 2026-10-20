package com.mayday.crawler;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 图片队列在同任务去重，但文章引用独立保存，防止相同图片在另一篇文章中消失。 */
@Getter
@Setter
@Table(value = "crawl_article_image", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class CrawlArticleImage extends BaseEntity
{

    /** 所属采集文章 ID；同一图片可以被多篇文章分别引用 */
    private Long articleId;

    /** 对应 IMAGE 队列项 ID；下载完成后通过其 file_id 读取文件，失败时保留关联供重试 */
    private Long itemId;

    /** 详情页序号与页内图片位置共同确定顺序，不能依据异步下载完成时间排序。 */
    private int sortOrder;
}
