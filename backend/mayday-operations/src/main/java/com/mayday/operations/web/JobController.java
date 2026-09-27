package com.mayday.operations.web;

import com.mayday.common.*;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.*;
import com.mayday.operations.repository.*;
import com.mayday.operations.service.JobRunner;
import com.mayday.security.AccessPolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/operations")
@RequiredArgsConstructor
public class JobController {
  private final ScheduledJobRepository jobs;
  private final JobExecutionRepository executions;
  private final JobRunner runner;
  private final AccessPolicy access;

  public record Edit(
      @NotBlank @Size(max = 100) String name,
      @NotBlank @Size(max = 64) String handler,
      @NotBlank @Size(max = 100) String cron,
      @Size(max = 500) String description,
      boolean enabled,
      Long version) {}

  @GetMapping("/scheduler")
  public ApiResponse<?> list(
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

  @PostMapping("/scheduler")
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody Edit req) {
    access.require("scheduler:create");
    return ApiResponse.ok(save(null, req));
  }

  @PutMapping("/scheduler/{id}")
  @Transactional
  public ApiResponse<?> update(@PathVariable Long id, @Valid @RequestBody Edit req) {
    access.require("scheduler:update");
    return ApiResponse.ok(save(id, req));
  }

  private ScheduledJob save(Long id, Edit req) {
    if (!JobRunner.HANDLERS.contains(req.handler())) throw new BusinessException("请选择已注册的处理器");
    var next = JobRunner.next(req.cron());
    var job =
        id == null
            ? new ScheduledJob()
            : jobs.lock(id).orElseThrow(() -> new BusinessException("任务不存在"));
    if (id != null) OperationSupport.version(job, req.version());
    job.setName(req.name());
    job.setHandler(req.handler());
    job.setCron(req.cron());
    job.setDescription(req.description());
    job.setEnabled(req.enabled());
    job.setNextRunAt(req.enabled() ? next : null);
    return jobs.saveAndFlush(job);
  }

  @DeleteMapping("/scheduler/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    access.require("scheduler:delete");
    jobs.delete(jobs.lock(id).orElseThrow(() -> new BusinessException("任务不存在")));
    return ApiResponse.ok(null);
  }

  @PostMapping("/scheduler/{id}/run")
  public ApiResponse<?> run(@PathVariable Long id) {
    access.require("scheduler:execute");
    return ApiResponse.ok(runner.run(id, true));
  }

  @GetMapping("/job-logs")
  public ApiResponse<?> logs(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("scheduler:view");
    return ApiResponse.ok(
        PageResult.from(
            executions.findAll(
                (r, q, c) -> SearchPredicates.contains(c, r.get("jobName"), keyword),
                PageResult.request(page, size))));
  }
}
