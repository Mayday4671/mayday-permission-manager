package com.mayday.crawler;

import java.time.LocalDateTime;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 规则随任务保存；开始后禁止原地修改，防止续跑时混用不同的分页语义。 */
@Getter
@Setter
@Table(value = "crawl_task", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class CrawlTask extends BaseEntity
{

    /** 用户填写的任务名称，不作为文件路径或命令执行 */
    private String name;

    /** 创建者账号 ID；逻辑关联 sys_user，决定任务默认可见范围和文件归属 */
    private Long ownerId;

    /** 创建者显示名快照；保留任务历史，不随改名更新 */
    private String ownerName;

    /** 实际点击运行的账号；领取和提交结果都重新检查这个账号的实时授权。 */
    private Long runnerId;

    /**
     * DRAFT 草稿、QUEUED 排队、RUNNING 执行、PAUSED 停止、COMPLETED 完成、PARTIAL 部分失败、LIMITED 达上限
     */
    private String status = "DRAFT";

    /** 已产生文章的配置删除后仅归档；保留来源和所有者供独立数据查询授权，不再显示或执行配置。 */
    @JsonIgnore
    private boolean archived;

    /** 已校验的采集规则 JSON；列表与详情各自分页，开始后规则不可原地修改 */
    @JsonIgnore
    private String rulesJson;

    /** 每次领取生成新租约，停止、到期或重领后旧工作器的结果会被拒绝。 */
    @JsonIgnore
    private String leaseToken;

    /** 租约截止时间；过期后允许其他工作器恢复 FETCHING 项 */
    @JsonIgnore
    private LocalDateTime leaseUntil;

    /** 最早下次请求时间；实现每任务限速与失败退避 */
    private LocalDateTime nextFetchAt;

    /** 可向用户展示的最近错误或停止原因；不保存堆栈、认证信息和远端正文 */
    private String lastError;

    /** 成功解析的列表和详情页面总数，不含图片请求 */
    private int pageCount;

    /** 成功保存的不同图片数量；同任务内容摘要去重后累计 */
    private int imageCount;

    /** 已达到三次尝试仍失败的队列项数量；显式重试时清零 */
    private int failedCount;

    /** 本任务成功保存图片的累计字节数；上限 200 MB，不重复统计去重图片 */
    private long totalBytes;

    /** 对外展示解析后的受控规则；原始 JSON 和执行租约不会序列化到客户端。 */
    public CrawlRules getRules()
    {
        return CrawlRules.parse(rulesJson);
    }
}
