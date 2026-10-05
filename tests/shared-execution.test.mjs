/**
 * 持久导出及调度控制的真实 API 回归。只操作随机隔离项目，本次记录的精确主键作为清理范围。
 * 取消/重试夹具先等待原导出完成，再精确设置未领取队列状态，不与活跃工作器竞争写测试状态。
 */
import { isolatedSql } from "./support/isolated-compose.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loginWithCaptcha } from "./support/captcha.mjs";

const base = process.env.API_BASE;
const project = process.env.API_TEST_COMPOSE_PROJECT;
const database = process.env.API_TEST_DATABASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(project ?? "") &&
  ["upgrade-db", "fresh-db"].includes(database) &&
  Boolean(base && process.env.ADMIN_PASSWORD);

/** 验收不打印请求、认证头或成功正文；仅以固定状态名称定位失败。 */
async function api(path, token, method = "GET", body, expected = 200, key) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, expected, `${method} ${path} 响应状态不符`);
  const result = await response.json();
  assert.equal(result.success, expected < 400);
  return result.data;
}

/** SQL 只针对此轮拥有的隔离数据库，不允许使用日常项目或客户端传来的任意服务名。 */
function sql(statement) {
  assert(isolated, "SQL 仅允许本次独立验收项目");
  return isolatedSql(statement).trim();
}

async function complete(id, token) {
  for (let count = 0; count < 200; count++) {
    const result = await api(`/bulk/jobs/${id}`, token);
    if (result.status === "SUCCEEDED") return result;
    assert(!["FAILED", "CANCELLED"].includes(result.status), "导出未成功终结");
    await delay(100);
  }
  throw new Error("导出未在期限内完成");
}

test(
  "持久导出与调度幂等、取消、恢复及无原始令牌存储",
  { skip: !isolated },
  async (t) => {
    const token = (
      await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
    ).token;
    let jobId, schedulerId;
    try {
      await t.test(
        "同一导出提交标识只有一份作业，不允许换筛选覆盖",
        async () => {
          const key = randomUUID();
          const filter = {
            keyword: "qa_shared_execution_" + randomUUID(),
            enabled: null,
            departmentId: null,
          };
          const first = await api(
            "/bulk/users/exports",
            token,
            "POST",
            filter,
            200,
            key,
          );
          jobId = first.id;
          const second = await api(
            "/bulk/users/exports",
            token,
            "POST",
            filter,
            200,
            key,
          );
          assert.equal(second.id, jobId);
          await api(
            "/bulk/users/exports",
            token,
            "POST",
            { ...filter, keyword: "changed" },
            400,
            key,
          );
          await complete(jobId, token);
          assert.equal(
            sql(
              `select count(*) from sys_durable_task where task_type='BULK_EXPORT' and business_key='${jobId}'`,
            ),
            "1",
          );
          assert.equal(
            sql(`select count(*) from sys_bulk_result where job_id=${jobId}`),
            "1",
          );
        },
      );
      await t.test(
        "取消与重试同事务协调队列及本人进度，成功后拒绝再次取消",
        async () => {
          sql(
            `update sys_durable_task set status='QUEUED',next_attempt_at=9999999999999 where task_type='BULK_EXPORT' and business_key='${jobId}'; update sys_bulk_job set status='QUEUED' where id=${jobId};`,
          );
          const cancelled = await api(
            `/bulk/jobs/${jobId}/cancel`,
            token,
            "POST",
          );
          assert.equal(cancelled.status, "CANCELLED");
          assert.equal(
            sql(
              `select status from sys_durable_task where task_type='BULK_EXPORT' and business_key='${jobId}'`,
            ),
            "CANCELLED",
          );
          await api(`/bulk/jobs/${jobId}/retry`, token, "POST");
          await complete(jobId, token);
          await api(
            `/bulk/jobs/${jobId}/cancel`,
            token,
            "POST",
            undefined,
            400,
          );
          await api(
            `/bulk/jobs/${jobId}/retry`,
            undefined,
            "POST",
            undefined,
            401,
          );
        },
      );
      await t.test("手动调度网络重试保留同一执行历史和业务键", async () => {
        const job = await api("/operations/scheduler", token, "POST", {
          name: "qa_durable_" + Date.now(),
          handler: "DATABASE_CHECK",
          cron: "0 0 1 * * *",
          enabled: true,
        });
        schedulerId = job.id;
        // 主键来自本轮创建回执；刻意设为较晚计划，首次手动执行会推进Cron，用于验收网络重试不换正文。
        assert(Number.isSafeInteger(schedulerId) && schedulerId > 0);
        sql(
          `update ops_job set next_run_at=timestampadd(hour,1,current_timestamp(6)) where id=${schedulerId};`,
        );
        const key = randomUUID();
        const first = await api(
          `/operations/scheduler/${schedulerId}/run`,
          token,
          "POST",
          undefined,
          200,
          key,
        );
        const second = await api(
          `/operations/scheduler/${schedulerId}/run`,
          token,
          "POST",
          undefined,
          200,
          key,
        );
        assert.equal(first.status, "SUCCESS");
        assert.equal(first.id, second.id);
        assert.equal(
          sql(
            `select count(*) from ops_job_execution where job_id=${schedulerId}`,
          ),
          "1",
        );
        assert.equal(
          sql(`select attempts from ops_job_execution where id=${first.id}`),
          "1",
        );
        await api(
          `/operations/job-logs/${first.id}/cancel`,
          token,
          "POST",
          undefined,
          400,
        );
        await api(
          `/operations/job-logs/${first.id}/retry`,
          undefined,
          "POST",
          undefined,
          401,
        );
      });
      await t.test(
        "共享安全表保存摘要，已消费凭证和原始会话令牌不留存",
        async () => {
          assert.equal(
            sql(
              `select count(*) from sys_security_state where token_key='${token}'`,
            ),
            "0",
          );
          assert.equal(
            sql(
              "select count(*) from sys_security_state where length(token_key)<>64 or token_key not regexp '^[a-f0-9]{64}$'",
            ),
            "0",
          );
          assert.equal(
            sql(
              "select count(*) from sys_security_rate where length(rate_key)<>64",
            ),
            "0",
          );
        },
      );
    } finally {
      if (schedulerId) {
        await api(`/operations/scheduler/${schedulerId}`, token, "DELETE");
        sql(
          `delete from sys_durable_task where task_type='SCHEDULER' and business_key like '${schedulerId}:%'; delete from ops_job_execution where job_id=${schedulerId};`,
        );
      }
      if (jobId)
        sql(
          `delete from sys_durable_task where task_type='BULK_EXPORT' and business_key='${jobId}'; delete from sys_bulk_job where id=${jobId};`,
        );
    }
  },
);
