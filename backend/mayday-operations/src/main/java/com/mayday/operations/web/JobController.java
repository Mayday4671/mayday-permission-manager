package com.mayday.operations.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.BusinessException;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.JobExecution;
import com.mayday.operations.model.ScheduledJob;
import com.mayday.operations.repository.JobExecutionRepository;
import com.mayday.operations.repository.ScheduledJobRepository;
import com.mayday.operations.service.JobRunner;
import com.mayday.security.AccessPolicy;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 调度配置与执行历史接口，只能选择已注册处理器；编辑、执行、查看和删除分别授权，不能上传脚本或SQL。 */
@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
public class JobController {
  private final ScheduledJobRepository jobs;
  private final JobExecutionRepository executions;
  private final JobRunner runner;
  private final AccessPolicy access;
  private final com.mayday.system.repository.UserRepository users;
  private final com.mayday.operations.service.AlertRecipients alertRecipients;

  /** 配置提交白名单，处理器名称来自注册Bean，Cron和接收人由服务验证；修改时版本必须与当前记录一致。 */
  @Schema(name = "ScheduledJobEdit")
  public record Edit(
      @NotBlank @Size(max = 100) String name,
      @NotBlank @Size(max = 64) String handler,
      @NotBlank @Size(max = 100) String cron,
      @Size(max = 500) String description,
      boolean enabled,
      Long alertUserId,
      Long version) {}

  /** 新业务实现 JobHandler 后自动出现在候选中；不允许页面传任意类名或脚本。 */
  @GetMapping("/scheduler/handlers")
  public ApiResponse<java.util.Map<String, String>> handlers() {
    access.require("scheduler:view");
    return ApiResponse.ok(runner.handlerOptions());
  }

  /** 提醒候选仅公开具有调度查看权的账号ID与展示名，不授予全站通讯录访问。 */
  @GetMapping("/scheduler/recipients")
  @Transactional(readOnly = true)
  public ApiResponse<java.util.List<com.mayday.operations.service.AlertRecipients.Option>>
      recipients(@RequestParam(defaultValue = "") String keyword) {
    access.require("scheduler:view");
    return ApiResponse.ok(alertRecipients.list("scheduler:view", keyword));
  }

  /** 查看权限下按名称与启用状态分页读取配置，不执行处理器或加载执行历史正文。 */
  @GetMapping("/scheduler")
  public ApiResponse<PageResult<ScheduledJob>> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean enabled,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("scheduler:view");
    return ApiResponse.ok(
        PageResult.from(
            jobs.findAll(
                (r, q, c) ->
                    c.and(
                        SearchPredicates.contains(c, r.get("name"), keyword),
                        enabled == null ? c.conjunction() : c.equal(r.get("enabled"), enabled)),
                PageResult.request(page, size))));
  }

  /** 新配置必须具备创建权限，验证注册处理器、六段Cron和可查看调度的告警接收人后提交。 */
  @PostMapping("/scheduler")
  @Transactional
  public ApiResponse<ScheduledJob> create(@Valid @RequestBody Edit req) {
    access.require("scheduler:create");
    return ApiResponse.ok(save(null, req));
  }

  /** 编辑权限及配置行锁保护更新，旧版本返回冲突；不会在保存配置时偷偷执行维护工作。 */
  @PutMapping("/scheduler/{id}")
  @Transactional
  public ApiResponse<ScheduledJob> update(@PathVariable Long id, @Valid @RequestBody Edit req) {
    access.require("scheduler:update");
    return ApiResponse.ok(save(id, req));
  }

  private ScheduledJob save(Long id, Edit req) {
    if (!runner.handlerOptions().containsKey(req.handler()))
      throw new BusinessException("请选择已注册的处理器");
    if (req.alertUserId() != null)
      users
          .findById(req.alertUserId())
          .filter(user -> access.hasFor(user, "scheduler:view"))
          .orElseThrow(() -> new BusinessException("提醒接收人需具有调度查看权限"));
    var next = JobRunner.next(req.cron());
    var job =
        id == null
            ? new ScheduledJob()
            : jobs.lock(id).orElseThrow(() -> new BusinessException("任务不存在"));
    if (id != null) {
      OperationSupport.version(job, req.version());
      runner.requireIdle(id);
    }
    job.setName(req.name());
    job.setHandler(req.handler());
    job.setCron(req.cron());
    job.setDescription(req.description());
    job.setEnabled(req.enabled());
    job.setAlertUserId(req.alertUserId());
    job.setNextRunAt(req.enabled() ? next : null);
    return jobs.saveAndFlush(job);
  }

  /** 删除仅移除锁定配置，历史执行结果独立保留；需要调度删除权限而不能用执行权限代替。 */
  @DeleteMapping("/scheduler/{id}")
  @Transactional
  public ApiResponse<Void> delete(@PathVariable Long id) {
    access.require("scheduler:delete");
    runner.requireIdle(id);
    jobs.delete(jobs.lock(id).orElseThrow(() -> new BusinessException("任务不存在")));
    return ApiResponse.ok(null);
  }

  /** 执行权限下按幂等键提交持久任务，返回当前执行记录；排队或运行状态需继续查询历史，HTTP成功不代表业务执行完成。 */
  @PostMapping("/scheduler/{id}/run")
  public ApiResponse<JobExecution> run(
      @PathVariable Long id,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    access.require("scheduler:execute");
    return ApiResponse.ok(runner.run(id, true, idempotencyKey));
  }

  /** 执行权限下取消排队或执行中的持久任务，旧租约不可提交成功。 */
  @PostMapping("/job-logs/{id}/cancel")
  public ApiResponse<JobExecution> cancel(@PathVariable Long id) {
    access.require("scheduler:execute");
    return ApiResponse.ok(runner.cancel(id));
  }

  /** 执行权限下明确恢复失败/取消记录；仍使用原冻结处理器与稳定幂等键。 */
  @PostMapping("/job-logs/{id}/retry")
  public ApiResponse<JobExecution> retry(@PathVariable Long id) {
    access.require("scheduler:execute");
    return ApiResponse.ok(runner.retry(id));
  }

  /** 查看权限下按配置ID和名称分页读执行历史，即使配置已删除也保留日志供诊断；大结果不默认一次加载。 */
  @GetMapping("/job-logs")
  public ApiResponse<PageResult<JobExecution>> logs(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Long jobId,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("scheduler:view");
    return ApiResponse.ok(
        PageResult.from(
            executions.findAll(
                (r, q, c) ->
                    c.and(
                        SearchPredicates.contains(c, r.get("jobName"), keyword),
                        jobId == null ? c.conjunction() : c.equal(r.get("jobId"), jobId)),
                PageResult.request(page, size))));
  }
}
