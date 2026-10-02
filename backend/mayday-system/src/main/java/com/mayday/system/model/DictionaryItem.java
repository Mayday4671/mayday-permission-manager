package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/** 字典类型仍使用 sys_entry；字典项拥有独立 ID、版本和唯一值，不再修改逗号拼接字符串。 */
@Entity
@Table(
    name = "sys_dictionary_item",
    uniqueConstraints = @UniqueConstraint(columnNames = {"dictionary_id", "value"}))
@Getter
@Setter
public class DictionaryItem extends BaseEntity {
  @Column(nullable = false)
  private Long dictionaryId;

  /** 展示名称可以修改，表单提交和已有业务值仍以 value 为准。 */
  @Column(nullable = false, length = 100)
  private String label;

  /** 在同一字典内由数据库保证唯一；业务保存项值时仍需确认此项处于启用状态。 */
  @Column(nullable = false, length = 100)
  private String value;

  @Column(length = 20)
  private String color;

  @Column(nullable = false)
  private int sortOrder;

  @Column(nullable = false)
  private boolean enabled = true;
}
