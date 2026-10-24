import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertCompleteContractSource } from "../scripts/api-contract-source.mjs";

test("完整功能实例允许导出，新增模块不需要维护另一份名称白名单", () => {
  assert.doesNotThrow(() =>
    assertCompleteContractSource({
      success: true,
      data: {
        modules: { content: true, workorders: true, futureModule: true },
      },
    }),
  );
});

test("关闭工单等模块时拒绝导出，避免删掉仍在前端编译的契约路径", () => {
  assert.throws(
    () =>
      assertCompleteContractSource({
        success: true,
        data: { modules: { content: true, workorders: false } },
      }),
    /workorders.*API_BASE.*原契约和类型保持不变/,
  );
});

test("不可验证或格式错误的模块清单不得被误当成完整实例", () => {
  for (const features of [
    undefined,
    { success: false, data: { modules: { content: true } } },
    { success: true },
    { success: true, data: { modules: {} } },
    { success: true, data: { modules: [] } },
    { success: true, data: { modules: { content: "true" } } },
    { success: true, data: { modules: { content: null } } },
  ]) {
    assert.throws(
      () => assertCompleteContractSource(features),
      /无法确认后端模块清单/,
    );
  }
});

test("在线生成遇到裁剪实例时不登录、不读取契约、不修改生成文件", async () => {
  const files = [
    new URL("../contracts/openapi.json", import.meta.url),
    new URL("../frontend/src/types/generated/api.ts", import.meta.url),
  ];
  const digest = async (file) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  const before = await Promise.all(files.map(digest));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        success: true,
        data: { modules: { content: true, workorders: false } },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL("../scripts/generate-api.mjs", import.meta.url),
          ),
        ],
        {
          env: {
            ...process.env,
            API_BASE: `http://127.0.0.1:${server.address().port}/api`,
            ADMIN_PASSWORD: "unused-contract-preflight-test",
          },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20000,
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /契约来源关闭了模块：workorders/);
    assert.deepEqual(requests, ["/api/platform/features"]);
    assert.deepEqual(await Promise.all(files.map(digest)), before);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
