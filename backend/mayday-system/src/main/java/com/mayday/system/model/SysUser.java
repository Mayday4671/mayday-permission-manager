package com.mayday.system.model;

import com.mayday.common.persistence.BaseEntity;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import java.util.HashSet;
import java.util.Set;
import lombok.Getter;
import lombok.Setter;

/**
 * 用户实体只在服务层使用；API 必须映射为 UserView，避免密码散列意外泄露。
 *
 * <p>岗位与角色关联表没有独立实体，字段标记为非列并由仓储读取时装配、保存时全量重建；直接 new 出来的对象集合为空，不能当作数据库真实授权。
 */
@Getter
@Setter
@Table(
    value = "sys_user",
    onInsert = BaseEntity.CreatedAtListener.class,
    onUpdate = BaseEntity.UpdatedAtListener.class)
public class SysUser extends BaseEntity {
  /** 岗位标识独立于角色授权；分配岗位不会自动产生操作权限。 */
  @Column(ignore = true)
  private Set<Long> postIds = new HashSet<>();

  private String username;

  /** BCrypt 摘要只在认证与设置密码边界使用，所有业务响应必须先映射为不含该字段的视图。 */
  private String passwordHash;

  private String nickname;

  /** 读取与写入邮箱分别检查字段权限；实体字段存在不代表任意用户可以看到它。 */
  private String email;

  /** 电话字段与邮箱采用独立授权，普通列表和导出共享相同的脱敏规则。 */
  private String phone;

  private Long departmentId;

  /** 停用后认证与后台任务授权均拒绝此账号，服务层同时撤销已有会话。 */
  private boolean enabled = true;

  /** 每次认证载入有效角色进行授权；不把前端缓存或登录时快照当作实际权限来源。 */
  @Column(ignore = true)
  private Set<SysRole> roles = new HashSet<>();
}
