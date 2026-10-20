package com.mayday.operations.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.FlowRequest;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.apache.ibatis.annotations.Mapper;

/**
 * 审批实例保留申请内容和审批人快照；使用版本号防止两个决策覆盖。
 *
 * <p>附件与顺序审批人存于 ops_request_file / ops_request_step（后者按 step_index 保序），标记为非列并由仓储读取时装配、保存时重建。
 */
@Mapper
public interface FlowRequestMapper extends EntityMapper<FlowRequest> {
  /** 各审批视角的 SQL 条件片段；参数顺序与占位符一致，由 boxParams 提供。 */
  private static String boxCondition(String box) {
    switch (box) {
      case "all":
        return "status <> 'DRAFT'";
      case "mine":
        return "applicant_id = ?";
      case "drafts":
        return "applicant_id = ? and status = 'DRAFT'";
      case "participated":
        return "exists (select 1 from ops_request_step s"
            + " where s.request_id = ops_flow_request.id and s.approver_id = ?)";
      case "todo":
        return "status = 'PENDING' and (id in (select request_id from ops_flow_task"
            + " where assignee_id = ? and status = 'PENDING')"
            + " or (schema_snapshot is null and current_approver_id = ?))";
      case "copies":
        return "id in (select request_id from ops_flow_task"
            + " where assignee_id = ? and kind = 'COPY')";
      default:
        return "id in (select request_id from ops_flow_task where assignee_id = ?"
            + " and status in ('APPROVED','REJECTED','RETURNED','TRANSFERRED'))";
    }
  }

  /** 与 boxCondition 占位符一一对应的绑定值。 */
  private static Object[] boxParams(String box, Long userId) {
    switch (box) {
      case "all":
        return new Object[0];
      case "todo":
        return new Object[] {userId, userId};
      default:
        return new Object[] {userId};
    }
  }

  default Optional<FlowRequest> lockById(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }

  default boolean existsByDefinitionId(Long id) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("definition_id").eq(id)))
        > 0;
  }

  /** 附件被任何历史申请引用时禁止删除文件；检查覆盖关联表而非当前指针。 */
  default boolean existsByAttachmentIdsContains(Long fileId) {
    Object count =
        Db.selectObject("select count(*) from ops_request_file where file_id = ?", fileId);
    return ((Number) count).longValue() > 0;
  }

  default boolean existsByBusinessTypeAndBusinessId(String businessType, Long businessId) {
    return selectCountByQuery(
            QueryWrapper.create()
                .where(new QueryColumn("business_type").eq(businessType))
                .and(new QueryColumn("business_id").eq(businessId)))
        > 0;
  }

  /** 子申请保留历史；父申请取消时仅传播到尚在运行的子申请。 */
  default List<FlowRequest> findByParentRequestIdOrderByIdAsc(Long parentRequestId) {
    return selectListByQuery(
        QueryWrapper.create()
            .where(new QueryColumn("parent_request_id").eq(parentRequestId))
            .orderBy("id asc"));
  }

  /** 按主键载入并装配附件与顺序审批人快照。 */
  @Override
  default Optional<FlowRequest> findById(Serializable id) {
    FlowRequest request = selectOneById(id);
    return request == null ? Optional.empty() : Optional.of(load(request));
  }

  /** 装配附件集合与按 step_index 排序的审批人列表。 */
  default FlowRequest load(FlowRequest request) {
    Set<Long> attachmentIds = new HashSet<>();
    for (var row :
        Db.selectListBySql(
            "select file_id from ops_request_file where request_id = ?", request.getId())) {
      attachmentIds.add(row.getLong("file_id"));
    }
    request.setAttachmentIds(attachmentIds);
    List<Long> approverIds = new ArrayList<>();
    for (var row :
        Db.selectListBySql(
            "select approver_id from ops_request_step where request_id = ? order by step_index",
            request.getId())) {
      approverIds.add(row.getLong("approver_id"));
    }
    request.setApproverIds(approverIds);
    return request;
  }

  /** 保存主表后在同一事务全量重建附件与顺序审批人。 */
  default void syncCollections(FlowRequest request) {
    Db.deleteBySql("delete from ops_request_file where request_id = ?", request.getId());
    for (Long fileId : request.getAttachmentIds()) {
      Db.updateBySql(
          "insert into ops_request_file(request_id, file_id) values (?, ?)",
          request.getId(),
          fileId);
    }
    Db.deleteBySql("delete from ops_request_step where request_id = ?", request.getId());
    for (int index = 0; index < request.getApproverIds().size(); index++) {
      Db.updateBySql(
          "insert into ops_request_step(request_id, step_index, approver_id) values (?, ?, ?)",
          request.getId(),
          index,
          request.getApproverIds().get(index));
    }
  }

  /**
   * 审批列表的统一查询条件：旧库退回保存曾覆盖 title，搜索计数不能成为探测私人标题的旁路； 非本人查看已退回/撤回且存在旧版 EDIT
   * 覆盖的申请时只按脱敏标题匹配，本人私人稿按草稿标题匹配。
   */
  default QueryWrapper listFilter(String keyword, String box, Long userId) {
    QueryWrapper wrapper = QueryWrapper.create();
    String safeTitle =
        "case when (applicant_id <> ? and status in ('RETURNED','WITHDRAWN','CANCELLED')"
            + " and private_draft is null and exists (select 1 from ops_flow_decision e"
            + " where e.request_id = ops_flow_request.id"
            + " and e.run_number = ops_flow_request.run_number and e.action = 'EDIT'"
            + " and e.id > (select max(d.id) from ops_flow_decision d"
            + " where d.request_id = ops_flow_request.id"
            + " and d.run_number = ops_flow_request.run_number"
            + " and d.action in ('RETURN','WITHDRAW'))))"
            + " then concat(coalesce(definition_name, '审批'), ' · 申请 #', id)"
            + " when applicant_id = ? and private_draft is not null"
            + " then json_unquote(json_extract(private_draft, '$.title')) else title end";
    wrapper.where(
        com.mayday.common.persistence.SearchPredicates.containsExpression(
                "lower(" + safeTitle + ")", keyword)
            .and(
                new com.mybatisflex.core.query.RawQueryCondition(
                    boxCondition(box), boxParams(box, userId))));
    return wrapper.orderBy("id desc");
  }
}
