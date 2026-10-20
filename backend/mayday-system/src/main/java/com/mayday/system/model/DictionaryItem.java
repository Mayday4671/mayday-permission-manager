package com.mayday.system.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Table;
import lombok.Getter;
import lombok.Setter;

/** 字典类型仍使用 sys_entry；字典项拥有独立 ID、版本和唯一值，不再修改逗号拼接字符串。 */
@Getter
@Setter
@Table(
    value = "sys_dictionary_item",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class DictionaryItem extends BaseEntity {
  private Long dictionaryId;

  /** 展示名称可以修改，表单提交和已有业务值仍以 value 为准。 */
  private String label;

  /** 在同一字典内由数据库保证唯一；业务保存项值时仍需确认此项处于启用状态。 */
  private String value;

  private String color;

  private int sortOrder;

  private boolean enabled = true;
}
