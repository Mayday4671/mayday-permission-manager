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

  /** 关键词按字面量匹配，状态筛选与行级范围在 SQL 中合并，分页总数不会扩大可见范围。 */
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

  /** 单条读取重用可见性检查；范围外记录即使主键存在也拒绝访问。 */
  public WorkOrderView get(Long id) {
    access.require("workorders:view");
    return WorkOrderView.from(visible(id));
  }

  /** 创建与授权复核在同一事务完成；归属由当前账号确定，CUSTOM 范围不能创建范围外记录。 */
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

  /** 编辑先校验原记录范围和客户端版本，只覆盖请求白名单字段，提交时由 JPA 再检查并发。 */
  @Transactional
  public WorkOrderView update(Long id, WorkOrderRequest request) {
    access.require("workorders:view");
    access.require("workorders:update");
    WorkOrder entity = visible(id);
    EntityVersions.requireCurrent(entity, request.version());
    assign(entity, request);
    return WorkOrderView.from(repository.saveAndFlush(entity));
  }

  /** 删除与刷新在同一事务完成；授权、版本或外键失败均回滚，禁止绕过页面直接删除他人数据。 */
  @Transactional
  public void delete(Long id, Long version) {
    access.require("workorders:view");
    access.require("workorders:delete");
    WorkOrder entity = visible(id);
    EntityVersions.requireCurrent(entity, version);
    repository.delete(entity);
    repository.flush();
  }

  /** 集中保护按 ID 读取和修改的入口，所有服务方法都必须先检查对应动作权限。 */
  private WorkOrder visible(Long id) {
    WorkOrder entity =
        repository.findById(id).orElseThrow(() -> new ResourceNotFoundException("工单管理不存在"));
    access.checkData("workorders", entity.getOwnerId(), entity.getDepartmentId());
    return entity;
  }

  /** 显式赋值业务字段，不能反射复制主键、创建者、部门或版本等服务器管理属性。 */
  private void assign(WorkOrder entity, WorkOrderRequest request) {
    entity.setTitle(Objects.toString(request.title(), "").trim());
    entity.setDescription(Objects.toString(request.description(), "").trim());
    entity.setEnabled(request.enabled());
  }
}
