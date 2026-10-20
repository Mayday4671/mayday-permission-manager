package com.mayday;

import java.util.Map;

import com.mayday.common.util.ModuleSwitches;
import com.mayday.operations.mapper.BusinessEventMapper;
import com.mayday.operations.mapper.ScheduledJobMapper;
import com.mayday.operations.service.JobRunner;
import com.mayday.operations.service.JobSchedule;
import com.mayday.operations.workflow.WorkflowEventWorker;
import com.mayday.operations.workflow.WorkflowEvents;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/** 可选模块关闭时不领取持久任务、不投递消息，停用期间的数据应留待重新开启后处理。 */
class ModuleWorkersTest
{
    @Test
    void disabledSchedulerDoesNotQueryOrExecuteJobs()
    {
        ScheduledJobMapper jobs = mock(ScheduledJobMapper.class);
        JobRunner runner = mock(JobRunner.class);
        ModuleSwitches modules = new ModuleSwitches();
        modules.setEnabled(Map.of("scheduler", false));
        new JobSchedule(jobs, runner, modules).tick();
        verifyNoInteractions(jobs, runner);
    }

    @Test
    void disabledNotificationDependencyStopsApprovalDelivery()
    {
        BusinessEventMapper events = mock(BusinessEventMapper.class);
        WorkflowEvents delivery = mock(WorkflowEvents.class);
        ModuleSwitches modules = new ModuleSwitches();
        modules.setEnabled(Map.of("notifications", false, "approvals", true));
        new WorkflowEventWorker(events, delivery, modules).run();
        verifyNoInteractions(events, delivery);
    }
}
