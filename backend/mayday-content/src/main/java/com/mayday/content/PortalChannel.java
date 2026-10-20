package com.mayday.content;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 门户栏目是独立导航和页面模板，不能由分类名称推断；稳定访问名称保护已有书签。 */
@Getter
@Setter
@Table(value = "cms_portal_channel", onInsert = BaseEntity.CreatedAtListener.class, onUpdate = BaseEntity.UpdatedAtListener.class)
public class PortalChannel extends BaseEntity
{

    /** 唯一访问名称；小写字母数字和短横线，创建后不可改，保持已有书签 */
    private String code;

    /** 导航及栏目页名称；不是内容分类名称，不用于鉴权 */
    private String name;

    /** 栏目模板：GUIDE知识指南/NOTICE日期公告/UPDATE更新时间轴/STORY图文杂志 */
    private String template;

    /** 栏目用途说明；展示于栏目页，服务端限制长度，不执行 HTML */
    private String description;

    /** 导航显示顺序；升序，同值再按主键排序 */
    private int sortOrder;

    /** 公开启用标记；停用同步阻断栏目、文章、封面及附件公开访问，不清除数据 */
    private boolean enabled = true;
}
