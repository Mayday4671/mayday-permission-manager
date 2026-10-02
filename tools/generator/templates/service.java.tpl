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

  public PageResult<{{entity}}View> list(String keyword, Boolean enabled, int page, int size) {
    access.require("{{resource}}:view");
    return PageResult.from(repository.findAll(access.<{{entity}}>filter("{{resource}}", "ownerId")
        .and((root, query, builder) -> builder.and(
            SearchPredicates.contains(builder, root.get("title"), keyword),
            enabled == null ? builder.conjunction() : builder.equal(root.get("enabled"), enabled))),
        PageResult.request(page, size)).map({{entity}}View::from));
  }

  public {{entity}}View get(Long id) {
    access.require("{{resource}}:view");
    return {{entity}}View.from(visible(id));
  }

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

  @Transactional
  public {{entity}}View update(Long id, {{entity}}Request request) {
    access.require("{{resource}}:view");
    access.require("{{resource}}:update");
    {{entity}} entity = visible(id);
    EntityVersions.requireCurrent(entity, request.version());
    assign(entity, request);
    return {{entity}}View.from(repository.saveAndFlush(entity));
  }

  @Transactional
  public void delete(Long id, Long version) {
    access.require("{{resource}}:view");
    access.require("{{resource}}:delete");
    {{entity}} entity = visible(id);
    EntityVersions.requireCurrent(entity, version);
    repository.delete(entity);
    repository.flush();
  }

  private {{entity}} visible(Long id) {
    {{entity}} entity = repository.findById(id)
        .orElseThrow(() -> new ResourceNotFoundException("{{label}}不存在"));
    access.checkData("{{resource}}", entity.getOwnerId(), entity.getDepartmentId());
    return entity;
  }

  private void assign({{entity}} entity, {{entity}}Request request) {
{{assignments}}
  }
}
