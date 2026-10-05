/**
 * 长时间验收命令的异步执行器。子进程输出只写私有日志，不继承终端；等待 close 时
 * 保持父进程事件循环可用，不阻塞 HTTP 定时器、健康探针或其他自有进程的退出事件。
 * 不重试、不改退出码；超时和输出超限只终止本次 spawn 创建的子进程句柄。
 */
import { spawn } from "node:child_process";
import { openSync, writeSync, closeSync } from "node:fs";

/** 返回与 spawnSync 相同的关键字段，调用方仍须检查 error 和 status。 */
export async function runVerificationProcess(
  command,
  args,
  {
    cwd,
    env,
    logPath,
    timeoutMs = 600_000,
    maxOutputBytes = 128 * 1024 * 1024,
  },
) {
  if (
    typeof command !== "string" ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string") ||
    typeof logPath !== "string" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1
  )
    throw new Error("验收子进程参数不合法");

  const handle = openSync(logPath, "w", 0o600);
  return await new Promise((resolve) => {
    const stdout = [],
      stderr = [];
    let outputBytes = 0,
      error;
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    /** 错误消息仅供私有调用方使用；公开诊断另外白名单提取标准错误码。 */
    function terminate(code, message) {
      if (error) return;
      error = new Error(message);
      error.code = code;
      child.kill("SIGKILL");
    }

    function capture(chunks, chunk) {
      try {
        writeSync(handle, chunk);
      } catch {
        terminate("EIO", "验收私有日志写入失败");
      }
      outputBytes += chunk.length;
      if (outputBytes <= maxOutputBytes) chunks.push(chunk);
      else terminate("ENOBUFS", "验收输出超过内存上限");
    }

    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.once("error", (cause) => {
      error ??= cause;
    });
    const timer = setTimeout(
      () => terminate("ETIMEDOUT", "验收子进程超过时间上限"),
      timeoutMs,
    );
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      closeSync(handle);
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error,
      });
    });
  });
}
