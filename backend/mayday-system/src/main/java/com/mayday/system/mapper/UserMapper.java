package com.mayday.system.mapper;

import java.io.Serializable;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import com.mybatisflex.core.mybatis.Mappers;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import com.mybatisflex.core.row.Row;
import org.apache.ibatis.annotations.Mapper;

/**
 * 用户仓储。角色与岗位关联表没有独立实体：所有按主键或用户名读取的入口都会装配关联明细， 与 JPA 时期的立即加载语义一致；保存主表后必须调用
 * {@link #syncCollections} 在同一事务重建关联。
 */
@Mapper
public interface UserMapper extends EntityMapper<SysUser>
{
    /** 岗位成员主键子查询。 */
    private static QueryWrapper selectPostMemberIds(Long postId)
    {
        return QueryWrapper.create().select(new QueryColumn("user_id")).from("sys_user_post")
                .where(new QueryColumn("post_id").eq(postId));
    }

    /** 登录按唯一用户名载入账号；不区分账号不存在、停用或密码错误向匿名用户暴露身份信息。 */
    default Optional<SysUser> findByUsername(String username)
    {
        SysUser user = selectOneByQuery(QueryWrapper.create().where(new QueryColumn("username").eq(username)));
        return user == null ? Optional.empty() : Optional.of(load(user));
    }

    /** 为按账号统计的配额提供串行化边界；只在短事务内持有，不能跨网络请求。 */
    default Optional<SysUser> lockById(Long id)
    {
        SysUser user = selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate());
        return user == null ? Optional.empty() : Optional.of(load(user));
    }

    /** 按主键载入并装配角色与岗位，保持与旧立即加载一致的授权可见性。 */
    @Override
    default Optional<SysUser> findById(Serializable id)
    {
        SysUser user = selectOneById(id);
        return user == null ? Optional.empty() : Optional.of(load(user));
    }

    /** 按主键集合载入并装配明细；角色委托边界检查依赖真实授权集合，不能只读基础列。 */
    @Override
    default List<SysUser> findAllById(Iterable<Long> ids)
    {
        List<SysUser> users = EntityMapper.super.findAllById(ids);
        users.forEach(this::load);
        return users;
    }

    /** 角色删除前检查实际账号引用，停用账号仍保留关联并阻止破坏性删除。 */
    default boolean existsByRoles_Id(Long roleId)
    {
        Object count = Db.selectObject("select count(*) from sys_user_role where role_id = ?", roleId);
        return ((Number) count).longValue() > 0;
    }

    /** 部门删除前检查归属账号，避免账号范围和负责人审批使用已删除部门。 */
    default boolean existsByDepartmentId(Long departmentId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("department_id").eq(departmentId))) > 0;
    }

    /** 按状态统计账号数量，查看全局统计前由调用方验证相应管理权限。 */
    default long countByEnabled(boolean enabled)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("enabled").eq(enabled)));
    }

    /** 装配角色（含授权明细）与岗位集合；调用方在事务内使用，不做跨请求缓存。 */
    default SysUser load(SysUser user)
    {
        RoleMapper roleEntityMapper = Mappers.ofMapperClass(RoleMapper.class);
        List<Long> roleIds = Db.selectListBySql("select role_id from sys_user_role where user_id = ?", user.getId())
                .stream().map(row -> row.getLong("role_id")).toList();
        Set<SysRole> roles = new HashSet<>();
        if (!roleIds.isEmpty())
        {
            roleEntityMapper.selectListByIds(roleIds).forEach(r -> roles.add(roleEntityMapper.load(r)));
        }
        user.setRoles(roles);
        Set<Long> posts = new HashSet<>();
        for (Row row : Db.selectListBySql("select post_id from sys_user_post where user_id = ?", user.getId()))
        {
            posts.add(row.getLong("post_id"));
        }
        user.setPostIds(posts);
        return user;
    }

    /** 按单一角色解析启用成员；供审批人快照与通知目标解析复用。 */
    default java.util.List<SysUser> membersOfRole(Long roleId)
    {
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("enabled").eq(true))
                .and(new com.mybatisflex.core.query.RawQueryCondition("exists (select 1 from sys_user_role ur"
                        + " where ur.user_id = sys_user.id and ur.role_id = ?)", roleId)));
    }

    /** 按多个角色解析启用成员；角色集合来自已校验的角色配置。 */
    default java.util.List<SysUser> membersOfRoles(java.util.Collection<Long> roleIds)
    {
        if (roleIds == null || roleIds.isEmpty())
        {
            return java.util.List.of();
        }
        return selectListByQuery(QueryWrapper.create().where(new QueryColumn("enabled").eq(true))
                .and(new QueryColumn("id").in(roleMemberIds(roleIds))));
    }

    /** 引用岗位的账号数；岗位删除保护由资料中心调用。 */
    default long countUsersByPost(Long postId)
    {
        return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("id").in(selectPostMemberIds(postId))));
    }

    /** 角色成员主键子查询；供通知等跨模块按角色限定账号范围。 */
    default QueryWrapper roleMemberIds(java.util.Collection<Long> roleIds)
    {
        return QueryWrapper.create().select(new QueryColumn("user_id")).from("sys_user_role")
                .where(new QueryColumn("role_id").in(roleIds));
    }

    /** 保存主表后在同一事务全量重建岗位与角色关联；调用方必须已完成主表保存。 */
    default void syncCollections(SysUser user)
    {
        Db.deleteBySql("delete from sys_user_post where user_id = ?", user.getId());
        for (Long postId : user.getPostIds())
        {
            Db.updateBySql("insert into sys_user_post(user_id, post_id) values (?, ?)", user.getId(), postId);
        }
        Db.deleteBySql("delete from sys_user_role where user_id = ?", user.getId());
        for (SysRole role : user.getRoles())
        {
            Db.updateBySql("insert into sys_user_role(user_id, role_id) values (?, ?)", user.getId(), role.getId());
        }
    }
}
