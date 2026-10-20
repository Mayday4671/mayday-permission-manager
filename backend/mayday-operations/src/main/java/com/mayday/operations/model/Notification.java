package com.mayday.operations.model;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 一次发布只有一份不可变正文；修改已发内容必须复制成新草稿，撤回不删除阅读历史。 */
@Getter
@Setter
@Table(value = "ops_notification", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class Notification extends BaseEntity
{
    /** 通知标题，最长 160 字 */

    private String title;
    /** 通知摘要；列表使用，避免列表返回完整富文本正文 */

    private String summary;
    /** 通知正文HTML或清洗后纯文本；最多50000字符，使用LONGTEXT兼容中文多字节，已发布正文不可原地修改 */

    private String content;
    /** 通知类别：NOTICE 通知、ANNOUNCEMENT 公告、REMINDER 提醒；由服务端白名单验证 */

    private String type = "NOTICE";
    /** 状态：DRAFT 草稿、PUBLISHED 已发布、WITHDRAWN 已撤回；过期还须检查 expires_at */

    private String status = "DRAFT";
    /** 接收范围：USERS 指定账号、DEPARTMENTS 部门、ROLES 角色、ALL 全部；发布时展开并冻结 */

    private String recipientType = "USERS";
    /** 创建者账号 ID，逻辑关联 sys_user.id；没有 notifications:all 时仅可管理本人通知 */

    private Long senderId;
    /** 发送者显示名快照；系统事件可使用系统名称 */

    private String senderName;
    /** 本批次发布时间；草稿为 NULL，发布后填写北京时间 */

    private LocalDateTime publishedAt;
    /** 到期时间；NULL 不设到期，超过时间收件人不能继续读取正文/附件 */

    private LocalDateTime expiresAt;
    /** 撤回时间；撤回后收件人正文与附件访问一并失效 */

    private LocalDateTime withdrawnAt;

    /** 关联业务标签由服务端白名单生成，不存任意页面 URL；打开关联记录仍独立鉴权。 */
    private String targetType;
    /** 业务跳转目标 ID，逻辑引用；跳转后的业务接口仍需独立鉴权 */

    private Long targetId;

    /** 系统投递唯一事件键，重复重试返回原消息；手动发布通知无需该键。 */
    private String eventKey;

    /** 收件人集合（ops_notification_target）；发布时冻结快照。 */
    @Column(ignore = true)
    private Set<Long> recipientIds = new HashSet<>();

    /** 附件集合（ops_notification_file）；读取走独立鉴权接口。 */
    @Column(ignore = true)
    private Set<Long> attachmentIds = new HashSet<>();
}
