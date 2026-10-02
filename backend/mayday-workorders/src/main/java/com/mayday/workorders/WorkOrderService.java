package com.mayday.workorders;

import com.mayday.common.EntityVersions;
import com.mayday.common.PageResult;
import com.mayday.common.ResourceNotFoundException;
import com.mayday.common.SearchPredicates;
import com.mayday.security.AccessPolicy;
import com.mayday.workorders.WorkOrderContracts.WorkOrderRequest;
import com.mayday.workorders.WorkOrderContracts.WorkOrderView;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 工单管理业务边界：每个公开方法独立授权，其他模块调用时也无法绕过 HTTP 层保护。 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class WorkOrderService {
  private final WorkOrderRepository repository;
  private final AccessPolicy access;

  public PageResult<WorkOrderView> list(String keyword, Boolean enabled, int page, int size) {
    access.require("workorders:view");
    return PageResult.from(
        repository
            .findAll(
                access
                    .<WorkOrder>filter("workorders", "ownerId")
                    .and(
                        (root, query, builder) ->
                            builder.and(
                                SearchPredicates.contains(builder, root.get("title"), keyword),
                                enabled == null
                                    ? builder.conjunction()
                                    : builder.equal(root.get("enabled"), enabled))),
                PageResult.request(page, size))
            .map(WorkOrderView::from));
  }

  public WorkOrderView get(Long id) {
    access.require("workorders:view");
    return WorkOrderView.from(visible(id));
  }

  @Transactional
  public WorkOrderView create(WorkOrderRequest request) {
    access.require("workorders:view");
    access.require("workorders:create");
    WorkOrder entity = new WorkOrder();
    entity.setOwnerId(access.current().getId());
    entity.setDepartmentId(access.current().getDepartmentId());
    // CUSTOM 只允许指定部门；不能创建一条自己不在授权范围内的记录。
    access.checkData("workorders", entity.getOwnerId(), entity.getDepartmentId());
    assign(entity, request);
    return WorkOrderView.from(repository.saveAndFlush(entity));
  }

  @Transactional
  public WorkOrderView update(Long id, WorkOrderRequest request) {
    access.require("workorders:view");
    access.require("workorders:update");
    WorkOrder entity = visible(id);
    EntityVersions.requireCurrent(entity, request.version());
    assign(entity, request);
    return WorkOrderView.from(repository.saveAndFlush(entity));
  }

  @Transactional
  public void delete(Long id, Long version) {
    access.require("workorders:view");
    access.require("workorders:delete");
    WorkOrder entity = visible(id);
    EntityVersions.requireCurrent(entity, version);
    repository.delete(entity);
    repository.flush();
  }

  private WorkOrder visible(Long id) {
    WorkOrder entity =
        repository.findById(id).orElseThrow(() -> new ResourceNotFoundException("工单管理不存在"));
    access.checkData("workorders", entity.getOwnerId(), entity.getDepartmentId());
    return entity;
  }

  private void assign(WorkOrder entity, WorkOrderRequest request) {
    entity.setTitle(Objects.toString(request.title(), "").trim());
    entity.setDescription(Objects.toString(request.description(), "").trim());
    entity.setEnabled(request.enabled());
  }
}
