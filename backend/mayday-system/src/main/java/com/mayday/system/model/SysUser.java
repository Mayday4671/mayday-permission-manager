package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.*;
import java.util.*;
import lombok.Getter;
import lombok.Setter;

/** 用户实体只在服务层使用；API 必须映射为 UserView，避免密码散列意外泄露。 */
@Getter
@Setter
@Entity
@Table(name = "sys_user")
public class SysUser extends BaseEntity {
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_user_post", joinColumns = @JoinColumn(name = "user_id"))
  @Column(name = "post_id", nullable = false)
  private java.util.Set<Long> postIds = new java.util.HashSet<>();

  @Column(nullable = false, unique = true, length = 64)
  private String username;

  @Column(nullable = false, length = 100)
  private String passwordHash;

  @Column(nullable = false, length = 64)
  private String nickname;

  @Column(length = 128)
  private String email;

  @Column(length = 32)
  private String phone;

  private Long departmentId;

  @Column(nullable = false)
  private boolean enabled = true;

  @ManyToMany(fetch = FetchType.EAGER)
  @JoinTable(
      name = "sys_user_role",
      joinColumns = @JoinColumn(name = "user_id"),
      inverseJoinColumns = @JoinColumn(name = "role_id"))
  private Set<SysRole> roles = new HashSet<>();
}
