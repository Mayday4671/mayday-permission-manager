package com.mayday.content;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.KeyType;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * 分类只属于一个门户栏目；分类本身继续复用资料中心的名称、启停与版本约束。
 *
 * <p>
 * 主键即资料中心的分类 ID，不继承业务实体的自增主键与审计列；分类与栏目名称由查询显式联表取得。
 */
@Getter
@Setter
@Table("cms_portal_category")
public class PortalCategory
{

    /** 内容分类主键，外键 sys_entry.id；服务端只接受 categories 类型，每分类只属于一栏目 */
    @Id(keyType = KeyType.None)
    private Long categoryId;

    /** 所属门户栏目，外键 cms_portal_channel.id；被历史修订引用后不能迁移或解除归属 */
    private Long channelId;

    /** 栏目内分类显示顺序；由后台关联列表次序产生，不改全局基础资料顺序 */
    private int sortOrder;
}
