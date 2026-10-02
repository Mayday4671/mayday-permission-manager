/**
 * 已部署后台的本机持续打流验收。必须先单独编译 mayday-netty 的 test-classes 与 runtime 依赖。
 * 临时源端/接收端共享后台容器网络，仅在回环地址发包；不改配置，不触碰外部目标或关闭其他运行批次。
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "../tests/support/captcha.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^(["'])(.*)\1$/, "$2"),
      ];
    }),
);
const id = Date.now().toString(),
  name = "mayday-relay-benchmark-" + id;
const output = join(root, ".local", "udp-relay-validation", id);
mkdirSync(output, { recursive: true });
const result = {
  status: "running",
  startedAt: new Date().toISOString(),
  samples: [],
};
const base = `http://127.0.0.1:${env.API_PORT || 18080}/api`;
let token, runId, child;
function docker(args) {
  const run = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  assert.equal(response.status, 200, `${path}: ${json.message}`);
  return json.data;
}
try {
  token = (await loginWithCaptcha(base, "admin", env.ADMIN_PASSWORD)).token;
  const config = await api("/relay/config"),
    before = await api("/relay/stats");
  assert.equal(before.state, "STOPPED", "已有转发在运行，验收不得覆盖或停止它");
  assert.equal(config.bindPort, 19000);
  assert.equal(config.targetIp, "127.0.0.1");
  assert.equal(config.targetPort, 19001);
  assert(
    ["127.0.0.1", "0.0.0.0"].includes(config.bindIp),
    "本机验收要求回环地址可达",
  );
  const backend = docker(["compose", "ps", "-q", "backend"]);
  assert(backend);
  const image = docker(["inspect", "--format", "{{.Image}}", backend]);
  result.config = config;
  result.image = image;
  const started = await api("/relay/start", { version: config.version });
  runId = started.runId;
  assert.equal(started.state, "RUNNING");
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--network",
    "container:" + backend,
    "--mount",
    `type=bind,src=${join(root, "backend/mayday-netty/target")},dst=/work,readonly`,
    "--entrypoint",
    "java",
    image,
    "-cp",
    "/work/test-classes:/work/classes:/work/dependency/*",
    "com.mayday.netty.UdpRelayBenchmark",
    "--external",
    "true",
    "--seconds",
    "30",
    "--mbps",
    "200",
    "--size",
    "1472",
    "--min-size",
    "100",
    "--max-size",
    "1472",
  ];
  child = spawn("docker", args, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    finished = false;
  child.stdout.on("data", (buffer) => (stdout += buffer));
  child.stderr.on("data", (buffer) => (stderr += buffer));
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      finished = true;
      resolve(code);
    });
  });
  while (!finished) {
    const snapshot = await api("/relay/stats");
    assert.equal(snapshot.runId, runId);
    result.samples.push(snapshot);
    await Promise.race([completion, delay(1000)]);
  }
  const code = await completion;
  writeFileSync(join(output, "benchmark.log"), stdout + stderr);
  result.benchmark = JSON.parse(
    stdout.split(/\r?\n/).find((l) => l.startsWith("{")),
  );
  result.final = await api("/relay/stop", { runId });
  runId = undefined;
  assert.equal(code, 0, "本机端点核对或速率没有通过，详见 benchmark.log");
  const final = result.final,
    bench = result.benchmark;
  assert.equal(final.receivedPackets, bench.sent);
  assert.equal(final.forwardedPackets, bench.unique);
  assert.equal(final.pendingPackets, 0);
  for (const key of [
    "invalidPackets",
    "overflowPackets",
    "sendFailures",
    "receiveErrors",
  ])
    assert.equal(final[key], 0, key);
  assert.notEqual(
    final.kernelDrops,
    null,
    "Linux 本 socket 丢包计数必须可观测",
  );
  assert.equal(final.kernelDrops, 0);
  assert.equal(final.forwardedBytes, bench.sentBytes);
  assert(
    result.samples.filter((s) => s.forwardMbps >= bench.targetMbps * 0.98)
      .length >= 20,
    "需观察至少 20 个接近目标速率的逐秒样本；端点总速率另按 0.5% 计时容差验证",
  );
  result.status = "passed";
  console.log(
    `通过：30 秒本机 UDP 转发，${bench.unique} 包，${bench.receiveMbps} Mbps，缺失/重复/错误均为零。`,
  );
} catch (error) {
  result.status = "failed";
  result.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (runId) {
    try {
      const state = await api("/relay/stats");
      if (state.runId === runId)
        result.final = await api("/relay/stop", { runId });
    } catch (error) {
      result.stopError = error.message;
    }
  }
  if (child && result.status !== "passed") {
    assert(/^mayday-relay-benchmark-\d+$/.test(name));
    spawnSync("docker", ["rm", "-f", name], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  result.finishedAt = new Date().toISOString();
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log("验收记录：" + output);
}
