package com.mayday.operations.workflow;

import com.mayday.common.BusinessException;
import com.mayday.operations.model.FlowRequest;
import java.util.Map;

/** 审批引擎的业务扩展点。应用模块实现内容审核，不让审批与内容模块彼此依赖。 回调参加同一数据库事务；任何验证失败都会同时回滚申请、任务、业务状态及通知事件。 */
public interface WorkflowBusiness {
  String type();

  /** 草稿同样必须核验业务归属、修订与版本，但不能占用送审状态。新适配器未实现时默认拒绝。 */
  default void validateDraft(FlowRequest request, Long businessVersion) {
    throw new BusinessException("当前业务尚未提供审批草稿鉴权");
  }

  /** 对业务 ID、修订、当前用户操作权再次鉴权，在业务主记录上加锁并返回审核快照。 */
  Map<String, Object> submitted(FlowRequest request, Long businessVersion);

  /** 只改变该申请实际绑定修订的审核元数据，绝不直接替用户发布。 */
  void completed(FlowRequest request);

  /** 仅在引擎已验证当前用户参与权之后调用。 */
  Map<String, Object> detail(FlowRequest request);
}
