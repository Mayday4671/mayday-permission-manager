package com.mayday.operations.workflow;

import java.time.LocalDateTime;
import java.util.Objects;

import com.mayday.common.util.BusinessTime;
import com.mayday.operations.mapper.FlowRequestMapper;
import com.mayday.operations.mapper.FlowTaskMapper;
import com.mayday.operations.model.FlowTask;
import com.mayday.operations.realtime.RealtimeEvents;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 到期任务先锁申请再重新读任务，与同意、转交、撤回使用相同锁顺序，避免结束后补发催办。 */
@Service
@RequiredArgsConstructor
public class WorkflowReminders
{
    private final FlowTaskMapper tasks;
    private final FlowRequestMapper requests;
    private final WorkflowEvents events;
    private final RealtimeEvents realtime;
    private final WorkflowOrchestrator orchestrator;

    /** 只提醒一次；事件与标记同事务提交，失败回滚后下一轮仍可安全重试。 */
    @Transactional
    public void timeout(Long taskId)
    {
        FlowTask candidate = tasks.findById(taskId).orElse(null);
        if (candidate == null)
        {
            return;
        }
        var rootCandidate = requests.findById(candidate.getRequestId()).orElse(null);
        if (rootCandidate != null && rootCandidate.getRootRequestId() != null)
        {
            requests.lockById(rootCandidate.getRootRequestId());
        }
        var request = requests.lockById(candidate.getRequestId()).orElse(null);
        if (request == null || !"PENDING".equals(request.getStatus()))
        {
            return;
        }
        // 第一次读可能早于等待行锁；拿锁后重新读取，确保读到前一个决策事务提交后的任务状态。
        candidate = tasks.findById(taskId).orElse(null);
        if (candidate == null)
        {
            return;
        }
        LocalDateTime now = BusinessTime.now();
        if (!"PENDING".equals(candidate.getStatus())
                || (candidate.getExecutionTokenId() == null
                        ? !Objects.equals(candidate.getNodeId(), request.getCurrentNodeId())
                        : !orchestrator.current(request, candidate))
                || candidate.getDueAt() == null || candidate.getDueAt().isAfter(now)
                || candidate.getTimeoutNotifiedAt() != null)
        {
            return;
        }
        events.enqueue(request, candidate.getAssigneeId(), "timeout:task:" + candidate.getId(), "审批任务已超过处理期限，请及时处理");
        candidate.setTimeoutNotifiedAt(now);
        tasks.save(candidate);
        realtime.changed(java.util.List.of(candidate.getAssigneeId(), request.getApplicantId()), "requests");
    }
}
