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

    /** 所属采集任务 ID；外键 crawl_task.id，接口必须核对归属 */
    private Long taskId;

    /** LIST 列表页、DETAIL 详情及详情续页、IMAGE 图片 */
    private String kind;

    /** QUEUED 排队、FETCHING 请求中、SUCCESS 成功、FAILED 失败、DUPLICATE 内容重复、SKIPPED 达上限跳过 */
    private String status = "QUEUED";

    /** 去掉片段并规范化的公开 HTTP/HTTPS 地址；实际访问前再次校验域名及 DNS */
    private String url;

    /** 规范化地址的 SHA-256 十六进制摘要；同任务同类型唯一，防止分页循环 */
    @JsonIgnore
    private String urlHash;

    /** 当前分页组的首次页面地址；同一文章所有图片分页使用相同 rootUrl 归档。 */
    private String rootUrl;

    /** 发现该链接的来源页地址；入口页为空，图片可追溯来源 */
    private String sourceUrl;

    /** 已解析 HTML 的网页标题摘要；纯文本展示，不执行网页 HTML */
    private String title;

    /** 页组内从 0 开始的页序号，图片条目不依赖此字段进行展示排序。 */
    private int ordinal;

    /** 本轮请求尝试次数；自动最多三次，手动重试失败项时归零 */
    private int attempts;

    /** 仅 SUCCESS/DUPLICATE 记录关联正文文件，重复图片复用首次成功保存的文件 ID。 */
    private Long fileId;

    /** 成功下载图片内容的 SHA-256 摘要；只在同任务内去重，避免跨账号信息暴露 */
    private String digest;

    /** 成功保存或引用图片的字节数；旧版重复记录、网页及失败项可能为零 */
    private long bytes;

    /** 该项最近一次请求或解析错误；不包含内部堆栈或网页正文 */
    private String error;

    /** 成功页面所属采集文章 ID；图片通过独立关联表关联文章，旧记录为空 */
    @JsonIgnore
    private Long articleId;

    /** 当前分页的正文纯文本；移除脚本、表单和导航，每页最多 20000 字符，不保存远端可执行 HTML */
    @JsonIgnore
    private String articleBody;

    /** 正文是否超出单页上限而被截断；详情必须向用户提示，旧记录默认否 */
    @JsonIgnore
    private boolean bodyTruncated;
}
