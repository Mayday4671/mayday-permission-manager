/**
 * API 验收的公开失败摘要与 Node test reporter。原 TAP 可能包含响应正文、密码令牌、
 * SQL 及 deepEqual 的用户数据，禁止作为 CI 附件。此模块只输出固定测试源码中的名称、
 * 相对文件和行号，以及枚举化错误类型、退出状态和测试计数；不复制 message/stack/value。
 */
import { readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const phases = new Set(["upgrade", "fresh"]);
const failureTypes = new Set([
  "testCodeFailure",
  "subtestsFailed",
  "cancelledByParent",
  "testTimeoutFailure",
  "hookFailed",
]);
const errorCodes = new Set([
  "ERR_ASSERTION",
  "ERR_TEST_FAILURE",
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_INVALID_ARG_TYPE",
  "ETIMEDOUT",
  "ENOENT",
  "EACCES",
  "EIO",
  "ENOBUFS",
]);
const operators = new Set([
  "==",
  "!=",
  "===",
  "!==",
  "strictEqual",
  "notStrictEqual",
  "deepEqual",
  "notDeepEqual",
  "deepStrictEqual",
  "notDeepStrictEqual",
  "match",
  "doesNotMatch",
  "throws",
  "doesNotThrow",
  "rejects",
  "doesNotReject",
  "fail",
]);

/** 只允许本仓库测试源码的相对路径，不能读取 .env、备份或任意宿主文件作为名称表。 */
function validFile(file) {
  return (
    typeof file === "string" &&
    /^tests\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.test\.mjs$/.test(file)
  );
}

/** 动态插值的名称可能夹带业务值，故仅识别静态双引号测试名称；未知名称不公开。 */
function staticNames(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /\b(?:test|it)\s*\(\s*("(?:\\.|[^"\\])*")/g,
  )) {
    try {
      const name = JSON.parse(match[1]);
      if (name.length <= 600 && !/[\u0000-\u001f\u007f]/.test(name))
        names.add(name);
    } catch {
      // 不是 JSON 兼容的静态字符串时，回退为文件和阶段定位，不求值或执行源码。
    }
  }
  return names;
}

function catalog(root, files) {
  const entries = new Map();
  for (const file of Array.isArray(files) ? files.slice(0, 64) : []) {
    if (!validFile(file)) continue;
    try {
      const source = readFileSync(resolve(root, file), "utf8");
      if (source.length <= 2 * 1024 * 1024)
        entries.set(file, staticNames(source));
    } catch {
      // 源文件不可读时不能将运行时名称当作可信静态名称。
    }
  }
  return entries;
}

/** 不访问 getter，防止错误对象的自定义属性读取再次抛错或暴露正文。 */
function own(object, key) {
  if (object === null || typeof object !== "object") return undefined;
  return Object.getOwnPropertyDescriptor(object, key)?.value;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : undefined;
}

function assertion(error) {
  const safe = {};
  const seen = new Set();
  for (let depth = 0; error && depth < 5 && !seen.has(error); depth++) {
    seen.add(error);
    for (const [key, allowed] of [
      ["failureType", failureTypes],
      ["code", errorCodes],
      ["operator", operators],
    ]) {
      const value = own(error, key);
      if (allowed.has(value)) safe[key] = value;
    }
    error = own(error, "cause");
  }
  return safe;
}

function safeFailure(data, root, entries) {
  const file =
    typeof data.file === "string"
      ? relative(root, resolve(data.file)).split(sep).join("/")
      : undefined;
  if (!entries.has(file)) return undefined;
  const failure = { file };
  if (entries.get(file).has(data.name)) failure.testName = data.name;
  for (const key of ["line", "column"])
    if (count(data[key]) > 0) failure[key] = data[key];
  const kind = assertion(own(data.details, "error"));
  if (Object.keys(kind).length) failure.assertion = kind;
  return failure;
}

/** 与 TAP 并行使用此 reporter；所有非失败事件的业务输出均丢弃。 */
export default async function* apiTestReporter(events) {
  const root = process.cwd();
  let files = [];
  try {
    files = JSON.parse(process.env.MAYDAY_API_DIAGNOSTIC_FILES ?? "[]");
  } catch {
    // 非法元信息不会退回打印原事件。
  }
  const entries = catalog(root, files);
  const report = {
    version: 1,
    phase: phases.has(process.env.MAYDAY_API_DIAGNOSTIC_PHASE)
      ? process.env.MAYDAY_API_DIAGNOSTIC_PHASE
      : "unknown",
    failures: [],
    unidentifiedFailures: 0,
    counts: {},
  };
  for await (const event of events) {
    if (event.type === "test:fail") {
      const failure = safeFailure(event.data, root, entries);
      if (failure && report.failures.length < 500) {
        report.failures.push(failure);
        if (!failure.testName) report.unidentifiedFailures++;
      } else report.unidentifiedFailures++;
    }
    if (event.type === "test:summary" && !event.data.file) {
      for (const key of ["tests", "passed", "failed", "cancelled", "skipped"])
        if (count(event.data.counts?.[key]) !== undefined)
          report.counts[key] = event.data.counts[key];
    }
  }
  yield JSON.stringify(report) + "\n";
}

/** 构造正常 Node 双 reporter 参数；TAP 仍到私有 stdout，公开 reporter 写单独 JSON。 */
export function apiDiagnosticReporterOptions({ phase, testFiles, reportPath }) {
  if (!phases.has(phase) || !testFiles.every(validFile))
    throw new Error("API 诊断阶段或测试路径不合法");
  return {
    args: [
      "--test-reporter=tap",
      "--test-reporter-destination=stdout",
      "--test-reporter=" + import.meta.url,
      "--test-reporter-destination=" + reportPath,
    ],
    env: {
      MAYDAY_API_DIAGNOSTIC_PHASE: phase,
      MAYDAY_API_DIAGNOSTIC_FILES: JSON.stringify(testFiles),
    },
  };
}

/** 父进程再次按源码白名单重建 JSON，不信任 reporter 文件中的额外字段或字符串。 */
export function publicApiFailureDiagnostic({
  phase,
  root,
  testFiles,
  response,
  reportPath,
}) {
  const entries = catalog(root, testFiles);
  let source;
  try {
    const contents = readFileSync(reportPath, "utf8");
    if (contents.length <= 1024 * 1024) source = JSON.parse(contents);
  } catch {
    // 崩溃、超时或 reporter 失败时仍保留阶段、退出状态，绝不解析私有原日志。
  }
  const report = {
    version: 1,
    phase: phases.has(phase) ? phase : "unknown",
    process: {
      exitCode: Number.isInteger(response.status) ? response.status : null,
    },
    failures: [],
    unidentifiedFailures: count(source?.unidentifiedFailures) ?? 0,
    counts: {},
  };
  if (["SIGKILL", "SIGTERM", "SIGABRT", "SIGINT"].includes(response.signal))
    report.process.signal = response.signal;
  const code = own(response.error, "code");
  if (errorCodes.has(code)) report.process.errorCode = code;
  for (const failure of Array.isArray(source?.failures)
    ? source.failures.slice(0, 500)
    : []) {
    if (!entries.has(failure?.file)) continue;
    const safe = { file: failure.file };
    if (entries.get(failure.file).has(failure.testName))
      safe.testName = failure.testName;
    for (const key of ["line", "column"])
      if (count(failure[key]) > 0) safe[key] = failure[key];
    const kind = assertion(failure.assertion);
    if (Object.keys(kind).length) safe.assertion = kind;
    report.failures.push(safe);
  }
  for (const key of ["tests", "passed", "failed", "cancelled", "skipped"])
    if (count(source?.counts?.[key]) !== undefined)
      report.counts[key] = source.counts[key];
  return report;
}
