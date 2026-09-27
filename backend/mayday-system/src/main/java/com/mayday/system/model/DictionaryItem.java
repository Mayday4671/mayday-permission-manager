package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
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

  @Column(nullable = false, length = 100)
  private String label;

  @Column(nullable = false, length = 100)
  private String value;

  @Column(length = 20)
  private String color;

  @Column(nullable = false)
  private int sortOrder;

  @Column(nullable = false)
  private boolean enabled = true;
}
