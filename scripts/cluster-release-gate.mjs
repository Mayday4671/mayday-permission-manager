/**
 * 原生升级的集群发布门槛，只读取当前仓库的私有验收目录，不启动服务或接受外部报告。
 * 报告身份、清理结果及真实运行副本摘要必须同时一致，单独的 passed 字样不能放行升级。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const runPattern = /^\d+-[a-f0-9]{6}$/;
// 与 verify-cluster 的十项正式检查一一对应；旧脚本的少量 passed 或重复检查不能冒充完整验收。
export const clusterReleaseChecks = Object.freeze([
  "同一spool第二实例拒启，避免并发重建与清理绕过本实例保护",
  "验证码跨节点验证、登录和一次性消费",
  "登录失败窗口跨节点共享并在实例重启后保留",
  "参数更新在其他节点立即可见，无本机缓存残留",
  "双节点 SSE 投递、全局账号配额及撤销会话断流",
  "手动调度跨实例并发重试只有一个执行记录",
  "导出作业跨节点幂等、独立文件目录下载一致",
  "交付JAR真实MySQL租约隔离、原子提交、重试取消及20路竞争",
  "运行中硬故障、心跳与环境租约配置、另一节点恢复完整单份 CSV",
  "正式持久任务 API 回归",
]);

/** 只接受明确的报告参数或自动查找；未知/缺值参数不能被静默忽略。 */
export function clusterReportArgument(argumentsList) {
  if (argumentsList.length === 0) return undefined;
  if (
    argumentsList.length === 2 &&
    argumentsList[0] === "--cluster-report" &&
    argumentsList[1]
  )
    return argumentsList[1];
  if (
    argumentsList.length === 1 &&
    argumentsList[0].startsWith("--cluster-report=") &&
    argumentsList[0].slice(17)
  )
    return argumentsList[0].slice(17);
  throw new Error(
    "用法：node scripts/upgrade-native.mjs [--cluster-report .local/cluster/<run>/report.json]",
  );
}

/** 逐层拒绝符号链接/目录联接，不能通过受控路径的外观读取另一仓库的报告或运行产物。 */
function regularPath(path, directory) {
  const stat = lstatSync(path);
  assert(
    !stat.isSymbolicLink(),
    "集群验收目录与文件不能使用符号链接或目录联接",
  );
  assert(
    directory ? stat.isDirectory() : stat.isFile(),
    "集群验收路径类型不正确",
  );
  return stat;
}

/** 校验一个精确私有报告及其运行副本，不将报告自带 path 字段当作文件定位依据。 */
function readVerifiedReport(root, path, artifactSha256) {
  const run = basename(dirname(path));
  assert(runPattern.test(run), "集群报告必须位于随机验收批次目录");
  assert.equal(
    path,
    join(root, ".local", "cluster", run, "report.json"),
    "集群报告不能跨仓库或使用任意 JSON 文件",
  );
  for (const directory of [
    join(root, ".local"),
    join(root, ".local", "cluster"),
    dirname(path),
  ])
    regularPath(directory, true);
  assert(
    regularPath(path, false).size <= 2 * 1024 * 1024,
    "集群验收报告大小超出上限",
  );
  const report = JSON.parse(readFileSync(path, "utf8"));
  assert(
    report.runId === run && report.project === "mayday-check-" + run,
    "集群报告身份与所在批次不一致",
  );
  assert(report.status === "passed", "集群验收必须全部通过");
  assert(
    report.cleanupSucceeded === true,
    "集群验收必须完成自有实例与数据库清理",
  );
  assert(
    report.artifactSha256 === artifactSha256,
    "集群验收与原生基线必须使用同一 Jar 摘要",
  );
  assert(
    Array.isArray(report.checks) &&
      report.checks.length === clusterReleaseChecks.length &&
      new Set(report.checks.map((check) => check?.name)).size ===
        clusterReleaseChecks.length &&
      report.checks.every(
        (check) =>
          check?.status === "passed" &&
          clusterReleaseChecks.includes(check.name) &&
          Number.isFinite(check.elapsedMs) &&
          check.elapsedMs >= 0,
      ),
    "集群验收必须包含十项不同且全部通过的正式检查",
  );
  const checks = new Map(report.checks.map((check) => [check.name, check]));
  const lock = checks.get(clusterReleaseChecks[0]),
    lease = checks.get(clusterReleaseChecks[7]),
    recovery = checks.get(clusterReleaseChecks[8]);
  assert(
    lock.secondInstanceRejected === true &&
      lock.originalInstanceHealthy === true,
    "集群验收必须证明同目录第二实例拒启且原实例健康",
  );
  assert(
    lease.concurrentClaims === 20 && lease.successfulLeaseOwners === 1,
    "集群验收必须证明持久领取只有一个租约拥有者",
  );
  assert(
    recovery.rows === 30000 &&
      recovery.attempts === 2 &&
      recovery.firstConcurrentDownloads === 6 &&
      recovery.spoolLifecycle === "passed" &&
      recovery.hardKillDirectoryLockReleased === true &&
      /^[a-f0-9]{64}$/.test(recovery.csvSha256 ?? ""),
    "集群验收必须完成真实硬故障、跨节点恢复与缓存生命周期检查",
  );
  const started = Date.parse(report.startedAt),
    finished = Date.parse(report.finishedAt);
  assert(
    Number.isFinite(started) &&
      Number.isFinite(finished) &&
      finished >= started,
    "集群验收必须具有完整完成时间",
  );
  const runtime = join(dirname(path), "runtime.jar");
  regularPath(runtime, false);
  assert.equal(
    createHash("sha256").update(readFileSync(runtime)).digest("hex"),
    artifactSha256,
    "集群运行副本已变化，请重新验收",
  );
  return {
    path,
    runId: run,
    artifactSha256,
    checks: report.checks.length,
    finishedAt: report.finishedAt,
  };
}

/**
 * 显式报告不满足门槛即失败；缺省仅查当前仓库 .local/cluster 内同产物的成功批次。
 * 任意失败/损坏/跨项目记录均不能作为发布证据，也不从其他仓库或用户路径寻找替代报告。
 */
export function verifiedClusterReport(root, artifactSha256, reportPath) {
  assert(
    /^[a-f0-9]{64}$/.test(artifactSha256 ?? ""),
    "需要已冻结 Jar 的有效 SHA-256 摘要",
  );
  const workspace = resolve(root);
  if (reportPath !== undefined)
    return readVerifiedReport(
      workspace,
      resolve(workspace, reportPath),
      artifactSha256,
    );
  const directory = join(workspace, ".local", "cluster");
  regularPath(join(workspace, ".local"), true);
  regularPath(directory, true);
  for (const run of readdirSync(directory)
    .filter((name) => runPattern.test(name))
    .sort()
    .reverse()) {
    try {
      return readVerifiedReport(
        workspace,
        join(directory, run, "report.json"),
        artifactSha256,
      );
    } catch {
      // 搜索模式跳过失败记录；显式报告模式不会回退到其他记录。
    }
  }
  throw new Error(
    "缺少同 Jar 且清理成功的完整集群验收，请先运行 scripts/verify-cluster.mjs",
  );
}
