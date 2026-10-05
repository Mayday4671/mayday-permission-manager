/**
 * Windows 一键开发服务的实际启停入口。PowerShell 仅转交明确参数，本入口使用参数数组和隔离环境启动 Java。
 * 每个子进程立即登记；健康失败保留日志和记录，不按端口杀进程，不删除 MySQL 或业务文件。
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertLocalDockerEndpoint,
  javaRuntimeEnvironment,
} from "./runtime-environment.mjs";
import {
  parseDevelopmentEnvironment,
  developmentConfiguration,
  assertDevelopmentProcess,
} from "./development-configuration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(root, ".local");
const recordPath = join(runtime, "processes.json");
process.umask(0o077);

/** CIM 查询只插入经过整数检查的 PID；UTF-8 输出兼容 Windows PowerShell 5.1 的中文目录。 */
function processInformation(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, "进程编号不合法");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,Name,CommandLine,ExecutablePath,@{Name='CreatedAt';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    },
  );
  assert(!result.error && result.status === 0, "无法核对本机进程身份");
  const output = result.stdout.replace(/^\uFEFF/, "").trim();
  return output ? JSON.parse(output) : null;
}

/** 记录写入临时文件再替换，避免异常退出留下半个 JSON；不把环境变量和密码写入记录。 */
function saveRecord(record) {
  const temporary = recordPath + ".tmp";
  writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(temporary, recordPath);
}

/** 构建和 Compose 日志保存在本次运行目录；终端只显示职责与失败位置，不输出配置内容。 */
function runCommand(command, args, cwd, environment, logPath, label) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    windowsHide: true,
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(logPath, (result.stdout ?? "") + (result.stderr ?? ""), {
    mode: 0o600,
  });
  assert(
    !result.error && result.status === 0,
    `${label} 失败，请查看 ${logPath}`,
  );
}

/** 只测试是否能绑定回环端口；被占用时失败，不尝试识别或结束占用者。 */
async function assertAvailablePort(port) {
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", () =>
      rejectPromise(
        new Error(`端口 ${port} 已被占用，请修改 .env 或先停止本项目实例`),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}

/** 后台隐藏运行并立即登记 PID，然后核对命令路径和创建时间；任一阶段失败都保留可安全停止的记录。 */
async function launch(record, role, command, args, cwd, environment) {
  const output = openSync(join(record.logDirectory, role + ".log"), "w", 0o600);
  const error = openSync(
    join(record.logDirectory, role + ".error.log"),
    "w",
    0o600,
  );
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env: environment,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, error],
    });
    child.on("error", () => {
      record.launchFailure = role;
      saveRecord(record);
    });
    record[role] = child.pid ?? null;
    saveRecord(record);
    child.unref();
  } finally {
    closeSync(output);
    closeSync(error);
  }
  await delay(200);
  assert(record[role], `${role} 创建失败，已保留运行日志`);
  const information = processInformation(record[role]);
  assert(information, `${role} 已退出，已保留进程记录与日志`);
  assertDevelopmentProcess(record, role, information, root);
  record.identities[role] = {
    pid: information.ProcessId,
    createdAt: information.CreatedAt,
    executable: information.ExecutablePath,
  };
  saveRecord(record);
  return child;
}

/** 每轮都检查本次子进程仍存在；只有指定接口成功才返回，超时与退出不会假报 ready。 */
async function awaitReady(record, role, url, isReady, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const information = processInformation(record[role]);
    assert(
      information && record.launchFailure !== role,
      `${role} 在就绪前退出，请查看本次日志`,
    );
    assertDevelopmentProcess(record, role, information, root);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await isReady(response))) return;
    } catch {}
    await delay(1000);
  }
  throw new Error(`${role} 未按时就绪，请查看 ${record.logDirectory}`);
}

/** 选择当前 shell 的 Java 或调用方 -JavaHome，校验版本时也不继承宿主 JVM 注入参数。 */
function javaExecutable(javaHome, environment) {
  if (javaHome) {
    const home = resolve(javaHome);
    const path = join(home, "bin", "java.exe");
    assert(existsSync(path), "JavaHome 没有可用的 bin/java.exe");
    environment.JAVA_HOME = home;
    return path;
  }
  const result = spawnSync("where.exe", ["java.exe"], {
    encoding: "utf8",
    env: environment,
    windowsHide: true,
  });
  const path = result.stdout?.split(/\r?\n/).find((value) => value.trim());
  assert(
    !result.error && result.status === 0 && path && existsSync(path.trim()),
    "请安装 Java 21 或指定 -JavaHome",
  );
  return path.trim();
}

/** 启动项目自己的 MySQL 与开发服务；所有端口、模块、身份和存储配置在任何变更前完成校验。 */
async function startDevelopment(options) {
  mkdirSync(runtime, { recursive: true });
  const environmentFile = join(root, ".env");
  if (!existsSync(environmentFile))
    copyFileSync(join(root, ".env.example"), environmentFile);
  const settings = parseDevelopmentEnvironment(
    readFileSync(environmentFile, "utf8"),
  );
  const configuration = developmentConfiguration(root, settings, process.env);
  assertLocalDockerEndpoint(configuration.dockerEnvironment);
  if (existsSync(recordPath)) {
    const previous = JSON.parse(
      readFileSync(recordPath, "utf8").replace(/^\uFEFF/, ""),
    );
    assert(
      resolve(previous.root) === root,
      "已有进程记录不属于当前项目，拒绝覆盖",
    );
    for (const role of ["backend", "frontend"])
      if (previous[role])
        assert(
          !processInformation(previous[role]),
          "已有记录的进程仍在运行，请先使用 scripts/stop.ps1",
        );
  }
  await assertAvailablePort(configuration.apiPort);
  await assertAvailablePort(configuration.webPort);
  const java = javaExecutable(options.javaHome, configuration.javaEnvironment);
  const version = spawnSync(java, ["-version"], {
    env: configuration.javaEnvironment,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  assert(
    !version.error &&
      version.status === 0 &&
      /version "21(?:\.|\")/.test(version.stderr + version.stdout),
    "本项目要求 Java 21，请检查 -JavaHome",
  );
  const runId = new Date().toISOString().replace(/\D/g, "");
  const logDirectory = join(runtime, "startup", runId);
  mkdirSync(logDirectory, { recursive: true });
  if (existsSync(recordPath))
    copyFileSync(recordPath, join(logDirectory, "previous-processes.json"));
  const record = {
    root,
    backend: null,
    frontend: null,
    identities: {},
    status: "starting",
    startedAt: new Date().toISOString(),
    logDirectory,
  };
  saveRecord(record);
  try {
    runCommand(
      "docker",
      [
        "compose",
        "--project-directory",
        root,
        "--env-file",
        environmentFile,
        "-f",
        join(root, "compose.yaml"),
        "up",
        "-d",
        "--wait",
        "--wait-timeout",
        "180",
        "mysql",
      ],
      root,
      configuration.dockerEnvironment,
      join(logDirectory, "mysql.log"),
      "本机 MySQL 启动",
    );
    if (!options.skipBuild)
      runCommand(
        "cmd.exe",
        ["/d", "/s", "/c", "mvnw.cmd -B package"],
        join(root, "backend"),
        configuration.javaEnvironment,
        join(logDirectory, "build.log"),
        "后端构建",
      );
    if (!existsSync(join(root, "frontend", "node_modules")))
      runCommand(
        "cmd.exe",
        ["/d", "/s", "/c", "npm.cmd ci"],
        join(root, "frontend"),
        javaRuntimeEnvironment(process.env, {}),
        join(logDirectory, "dependencies.log"),
        "前端依赖安装",
      );
    const jar = join(runtime, "mayday-runtime.jar");
    copyFileSync(
      join(
        root,
        "backend",
        "mayday-application",
        "target",
        "mayday-application-1.0.0.jar",
      ),
      jar,
    );
    await launch(
      record,
      "backend",
      java,
      ["-jar", jar, "--spring.config.location=classpath:/application.yml"],
      root,
      configuration.javaEnvironment,
    );
    await awaitReady(
      record,
      "backend",
      `http://127.0.0.1:${configuration.apiPort}/actuator/health`,
      async (response) => (await response.json()).status === "UP",
    );
    const features = await fetch(
      `http://127.0.0.1:${configuration.apiPort}/api/platform/features`,
      { signal: AbortSignal.timeout(3000) },
    );
    assert(features.ok, "后端功能清单未就绪");
    const expectedFeatures = await features.json();
    const vite = join(
      root,
      "frontend",
      "node_modules",
      "vite",
      "bin",
      "vite.js",
    );
    await launch(
      record,
      "frontend",
      process.execPath,
      [
        vite,
        "--host",
        "127.0.0.1",
        "--port",
        String(configuration.webPort),
        "--strictPort",
      ],
      join(root, "frontend"),
      configuration.frontendEnvironment,
    );
    await awaitReady(
      record,
      "frontend",
      `http://127.0.0.1:${configuration.webPort}/`,
      async (response) => (await response.text()).includes("<html"),
      45,
    );
    // 验证真实 Vite /api 代理指向这次后端，单独的首页 200 不能代表页面可用。
    await awaitReady(
      record,
      "frontend",
      `http://127.0.0.1:${configuration.webPort}/api/platform/features`,
      async (response) =>
        JSON.stringify(await response.json()) ===
        JSON.stringify(expectedFeatures),
      45,
    );
    for (const role of ["backend", "frontend"]) {
      const information = processInformation(record[role]);
      assert(information, `${role} 在最终就绪检查时已退出`);
      assertDevelopmentProcess(record, role, information, root);
    }
    record.status = "ready";
    record.readyAt = new Date().toISOString();
    saveRecord(record);
    console.log(`前台门户：http://127.0.0.1:${configuration.webPort}/`);
    console.log(`后台登录：http://127.0.0.1:${configuration.webPort}/login`);
    console.log(`前后端及代理已就绪；日志：${logDirectory}`);
    console.log("管理员账号：admin；密码读取 .env 中的 ADMIN_PASSWORD。");
  } catch (error) {
    record.status = "failed";
    record.failedAt = new Date().toISOString();
    saveRecord(record);
    throw error;
  }
}

/** 全部身份先核对再停止；部分失败保留记录，成功也保留历史日志，MySQL 和文件不删除。 */
async function stopDevelopment() {
  if (!existsSync(recordPath)) {
    console.log("没有发现本地开发进程记录；MySQL 保持运行。");
    return;
  }
  const record = JSON.parse(
    readFileSync(recordPath, "utf8").replace(/^\uFEFF/, ""),
  );
  assert(resolve(record.root) === root, "进程记录与当前项目不一致");
  const live = [];
  for (const role of ["backend", "frontend"]) {
    if (!record[role]) continue;
    const information = processInformation(record[role]);
    assertDevelopmentProcess(record, role, information, root);
    if (information) live.push({ role, pid: record[role] });
  }
  for (const { role, pid } of live) {
    assertDevelopmentProcess(record, role, processInformation(pid), root);
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -ErrorAction Stop`],
      { encoding: "utf8", windowsHide: true, timeout: 15000 },
    );
    assert(
      !result.error && result.status === 0,
      `${role} 停止失败，保留进程记录`,
    );
    let stopped = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!processInformation(pid)) {
        stopped = true;
        break;
      }
      await delay(250);
    }
    assert(stopped, `${role} 停止超时，保留进程记录`);
  }
  unlinkSync(recordPath);
  console.log("前后端开发服务已停止，历史日志、MySQL 及业务文件均保留。");
}

try {
  assert.equal(
    process.platform,
    "win32",
    "原生开发启停入口仅适用于 Windows；其他平台使用 Compose",
  );
  const [action, ...args] = process.argv.slice(2);
  const options = { skipBuild: false, javaHome: process.env.JAVA_HOME };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--skip-build") options.skipBuild = true;
    else if (args[index] === "--java-home") {
      options.javaHome = args[++index];
      assert(options.javaHome, "--java-home 缺少路径");
    } else throw new Error("未知启动参数");
  }
  if (action === "start") await startDevelopment(options);
  else if (action === "stop" && args.length === 0) await stopDevelopment();
  else throw new Error("请使用 scripts/start.ps1 或 scripts/stop.ps1");
} catch (error) {
  console.error(error.message);
  console.error(
    "未报告就绪；运行日志与进程记录保留。已登记进程可用 scripts/stop.ps1 安全停止。",
  );
  process.exitCode = 1;
}
