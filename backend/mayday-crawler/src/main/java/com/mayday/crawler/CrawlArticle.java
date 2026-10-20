package com.mayday.crawler;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 每个任务内一个分页组对应一篇文章；正文按页保存在队列项，重试不会重复拼接正文。 */
@Getter
@Setter
@Table(value = "crawl_article", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class CrawlArticle extends BaseEntity
{

    /** 所属采集任务；读取文章前必须校验任务权限和所有者 */
    private Long taskId;

    /** 文章分页组首页的规范化公开地址；后续详情分页归入同一文章 */
    private String sourceUrl;

    /** 来源首页 URL 的 SHA-256；与任务 ID 组成唯一键，防止重试生成重复文章 */
    @JsonIgnore
    private String sourceHash;

    /** 文章标题纯文本；优先配置字段，再读取 h1、OG 标题或网页标题 */
    private String title;

    /** 正文开头的纯文本摘要；压缩空白后最多 300 字符，无正文时为空字符串 */
    private String summary = "";

    /** 来源作者原始文本；不映射本系统账号，无法识别时为空字符串 */
    private String author = "";

    /** 来源站点的日期文本，不强制猜测时区；采集时间由 BaseEntity.createdAt 单独记录。 */
    private String publishedAt = "";
}
