package com.mayday.{{module}};

import com.mayday.common.EntityVersions;
import com.mayday.common.PageResult;
import com.mayday.common.ResourceNotFoundException;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.{{module}}.{{entity}}Contracts.{{entity}}Request;
import com.mayday.{{module}}.{{entity}}Contracts.{{entity}}View;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {{label}}业务边界：每个公开方法独立授权，其他模块调用时也无法绕过 HTTP 层保护。 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class {{entity}}Service {
  private final {{entity}}Repository repository;
  private final AccessPolicy access;

  /** 关键词按字面量匹配，状态筛选与行级范围在 SQL 中合并，分页总数不会扩大可见范围。 */
  public PageResult<{{entity}}View> list(String keyword, Boolean enabled, int page, int size) {
    access.require("{{resource}}:view");
    return PageResult.from(repository.findAll(access.<{{entity}}>filter("{{resource}}", "ownerId")
        .and((root, query, builder) -> builder.and(
            SearchPredicates.contains(builder, root.get("title"), keyword),
            enabled == null ? builder.conjunction() : builder.equal(root.get("enabled"), enabled))),
        PageResult.request(page, size)).map({{entity}}View::from));
  }

  /** 单条读取重用可见性检查；范围外记录即使主键存在也拒绝访问。 */
  public {{entity}}View get(Long id) {
    access.require("{{resource}}:view");
    return {{entity}}View.from(visible(id));
  }

  /** 创建与授权复核在同一事务完成；归属由当前账号确定，CUSTOM 范围不能创建范围外记录。 */
  @Transactional
  public {{entity}}View create({{entity}}Request request) {
    access.require("{{resource}}:view");
    access.require("{{resource}}:create");
    {{entity}} entity = new {{entity}}();
    entity.setOwnerId(access.current().getId());
    entity.setDepartmentId(access.current().getDepartmentId());
    // CUSTOM 只允许指定部门；不能创建一条自己不在授权范围内的记录。
    access.checkData("{{resource}}", entity.getOwnerId(), entity.getDepartmentId());
    assign(entity, request);
    return {{entity}}View.from(repository.saveAndFlush(entity));
  }

  /** 编辑先校验原记录范围和客户端版本，只覆盖请求白名单字段，提交时由 JPA 再检查并发。 */
  @Transactional
  public {{entity}}View update(Long id, {{entity}}Request request) {
    access.require("{{resource}}:view");
    access.require("{{resource}}:update");
    {{entity}} entity = visible(id);
    EntityVersions.requireCurrent(entity, request.version());
    assign(entity, request);
    return {{entity}}View.from(repository.saveAndFlush(entity));
  }

  /** 删除与刷新在同一事务完成；授权、版本或外键失败均回滚，禁止绕过页面直接删除他人数据。 */
  @Transactional
  public void delete(Long id, Long version) {
    access.require("{{resource}}:view");
    access.require("{{resource}}:delete");
    {{entity}} entity = visible(id);
    EntityVersions.requireCurrent(entity, version);
    repository.delete(entity);
    repository.flush();
  }

  /** 集中保护按 ID 读取和修改的入口，所有服务方法都必须先检查对应动作权限。 */
  private {{entity}} visible(Long id) {
    {{entity}} entity = repository.findById(id)
        .orElseThrow(() -> new ResourceNotFoundException("{{label}}不存在"));
    access.checkData("{{resource}}", entity.getOwnerId(), entity.getDepartmentId());
    return entity;
  }

  /** 显式赋值业务字段，不能反射复制主键、创建者、部门或版本等服务器管理属性。 */
  private void assign({{entity}} entity, {{entity}}Request request) {
{{assignments}}
  }
}
