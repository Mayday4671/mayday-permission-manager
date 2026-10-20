package com.mayday.operations.mapper;

import com.mayday.common.persistence.EntityMapper;
import com.mayday.operations.model.FlowDefinition;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.row.Db;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;

/**
 * 定义草稿写入使用行锁；发布版本和历史实例由各自仓储保存，不能覆盖历史快照。
 *
 * <p>旧顺序审批人存于 ops_flow_step（按 step_index 保序），标记为非列并由仓储读取时装配、保存时重建。
 */
@Mapper
public interface FlowDefinitionMapper extends EntityMapper<FlowDefinition> {
  default Optional<FlowDefinition> lockById(Long id) {
    return Optional.ofNullable(
        selectOneByQuery(QueryWrapper.create().where(new QueryColumn("id").eq(id)).forUpdate()));
  }

  default boolean existsByCategoryId(Long id) {
    return selectCountByQuery(QueryWrapper.create().where(new QueryColumn("category_id").eq(id)))
        > 0;
  }

  /** 按主键载入并装配顺序审批人快照。 */
  @Override
  default Optional<FlowDefinition> findById(Serializable id) {
    FlowDefinition definition = selectOneById(id);
    return definition == null ? Optional.empty() : Optional.of(load(definition));
  }

  /** 装配按 step_index 排序的旧审批人列表；新运行流程以发布快照为准。 */
  default FlowDefinition load(FlowDefinition definition) {
    List<Long> approverIds = new ArrayList<>();
    for (var row :
        Db.selectListBySql(
            "select approver_id from ops_flow_step where definition_id = ? order by step_index",
            definition.getId())) {
      approverIds.add(row.getLong("approver_id"));
    }
    definition.setApproverIds(approverIds);
    return definition;
  }

  /** 保存主表后在同一事务按位置重建顺序审批人。 */
  default void syncSteps(FlowDefinition definition) {
    Db.deleteBySql("delete from ops_flow_step where definition_id = ?", definition.getId());
    for (int index = 0; index < definition.getApproverIds().size(); index++) {
      Db.updateBySql(
          "insert into ops_flow_step(definition_id, step_index, approver_id) values (?, ?, ?)",
          definition.getId(),
          index,
          definition.getApproverIds().get(index));
    }
  }
}
