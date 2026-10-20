package com.mayday.operations.feedback;

import java.time.LocalDateTime;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 客户反馈主记录；查询凭据仅存摘要，匿名响应不包含内部备注和处理人身份。 */
@Getter
@Setter
@Table(value = "ops_feedback", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class Feedback extends BaseEntity
{

    /** 随机48位十六进制查询码的SHA-256摘要；只在创建响应展示一次原码，数据库不保存明码 */
    private String receiptHash;

    /** 反馈类型：QUESTION使用问题、SUGGESTION建议、CORRECTION内容纠错 */
    private String type;

    /** 客户填写的问题或建议标题；纯文本展示，不执行HTML */
    private String title;

    /** 客户填写的详细说明；长度上限4000，按纯文本展示，不作为脚本或富文本执行 */
    private String content;

    /** 内容纠错关联的文章编号；可为空，仅供定位，不据此授予文章管理权 */
    private Long articleId;

    /** 客户自愿填写的联系邮箱；仅后台有反馈查看权限者可见，不在匿名查询或审计返回 */
    private String contact;

    /** 处理状态：OPEN待处理、PROCESSING处理中、RESOLVED已解决、CLOSED已关闭；解决必须有客户可见回复 */
    private String status = "OPEN";

    /** 分配处理人的账号ID；NULL为未分配，服务端检查有效账号及反馈处理权限 */
    private Long assigneeId;

    /** 分配时处理人的展示名快照；匿名查询不返回，不作为授权依据 */
    private String assigneeName;

    /** 最近客户可见回复时间；NULL为未回复，内部备注不更新该字段 */
    private LocalDateTime repliedAt;
}
