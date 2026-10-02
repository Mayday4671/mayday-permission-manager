package com.mayday.system.model;

import com.mayday.common.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;
import java.util.HashSet;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

/** 用户实体只在服务层使用；API 必须映射为 UserView，避免密码散列意外泄露。 */
@Getter
@Setter
@Entity
@Table(name = "sys_user")
public class SysUser extends BaseEntity {
  /** 岗位标识独立于角色授权；分配岗位不会自动产生操作权限。 */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "sys_user_post", joinColumns = @JoinColumn(name = "user_id"))
  @Column(name = "post_id", nullable = false)
  private Set<Long> postIds = new HashSet<>();

  @Column(nullable = false, unique = true, length = 64)
  private String username;

  /** BCrypt 摘要只在认证与设置密码边界使用，所有业务响应必须先映射为不含该字段的视图。 */
  @Column(nullable = false, length = 100)
  private String passwordHash;

  @Column(nullable = false, length = 64)
  private String nickname;

  /** 读取与写入邮箱分别检查字段权限；实体字段存在不代表任意用户可以看到它。 */
  @Column(length = 128)
  private String email;

  /** 电话字段与邮箱采用独立授权，普通列表和导出共享相同的脱敏规则。 */
  @Column(length = 32)
  private String phone;

  private Long departmentId;

  /** 停用后认证与后台任务授权均拒绝此账号，服务层同时撤销已有会话。 */
  @Column(nullable = false)
  private boolean enabled = true;

  /** 每次认证载入有效角色进行授权；不把前端缓存或登录时快照当作实际权限来源。 */
  @ManyToMany(fetch = FetchType.EAGER)
  @JoinTable(
      name = "sys_user_role",
      joinColumns = @JoinColumn(name = "user_id"),
      inverseJoinColumns = @JoinColumn(name = "role_id"))
  private Set<SysRole> roles = new HashSet<>();
}
