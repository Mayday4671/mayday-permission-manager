import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, tokenStore } from "../src/lib/api";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: { origin: "http://localhost" },
    dispatchEvent: () => true,
  },
});
const {
  previewImport,
  commitImport,
  createExport,
  listBulkJobs,
  downloadBulkResult,
} = await import("../src/lib/bulk-data");

test("契约导入发送真实文件和浏览器 multipart 边界，预览只返回脱敏字段", async () => {
  const contents = "username,nickname,password\r\nmember,成员,private-password";
  const file = new File([contents], "用户导入.csv", { type: "text/csv" });
  tokenStore.set("import-session");
  globalThis.fetch = async (input) => {
    assert.ok(input instanceof Request);
    assert.equal(new URL(input.url).pathname, "/api/bulk/users/import/preview");
    assert.equal(input.method, "POST");
    assert.equal(input.headers.get("Authorization"), "Bearer import-session");
    assert.match(
      input.headers.get("Content-Type") ?? "",
      /^multipart\/form-data; boundary=/,
    );
    const body = await input.formData();
    const uploaded = body.get("file");
    assert.ok(uploaded instanceof File);
    assert.equal(uploaded.name, file.name);
    assert.equal(await uploaded.text(), contents);
    return Response.json({
      success: true,
      data: {
        totalRows: 1,
        validRows: 1,
        rows: [
          {
            rowNumber: 2,
            values: {
              username: "member",
              nickname: "成员",
              password: "已提供",
            },
            errors: [],
          },
        ],
      },
    });
  };
  const preview = await previewImport("users", file);
  assert.equal(preview.rows[0]?.values.password, "已提供");
  assert.ok(!JSON.stringify(preview).includes("private-password"));
});

test("提交幂等键使用契约查询参数，导出仅发送白名单条件并查询本人作业", async () => {
  const file = new File(["username,password\r\nmember,password"], "users.csv");
  let requestNumber = 0;
  globalThis.fetch = async (input) => {
    assert.ok(input instanceof Request);
    const address = new URL(input.url);
    requestNumber++;
    if (requestNumber === 1) {
      assert.equal(address.pathname, "/api/bulk/users/import/commit");
      assert.equal(
        address.searchParams.get("idempotencyKey"),
        "same-file-retry-key",
      );
      const body = await input.formData();
      assert.equal([...body.keys()].join(","), "file");
      return Response.json({
        success: true,
        data: { jobId: 42, importedRows: 1 },
      });
    }
    if (requestNumber === 2) {
      assert.equal(address.pathname, "/api/bulk/users/exports");
      assert.deepEqual(await input.json(), {
        keyword: "成员",
        enabled: false,
        departmentId: null,
      });
      return Response.json({
        success: true,
        data: {
          id: 43,
          resource: "users",
          kind: "EXPORT",
          status: "QUEUED",
          processedRows: 0,
          totalRows: 0,
          createdAt: "2026-10-02T12:00:00",
          expiresAt: "2026-10-03T12:00:00",
        },
      });
    }
    assert.equal(address.pathname, "/api/bulk/jobs");
    assert.equal(address.search, "");
    return Response.json({ success: true, data: [] });
  };
  assert.equal(
    (await commitImport("users", file, "same-file-retry-key")).jobId,
    42,
  );
  await createExport("users", {
    keyword: "成员",
    enabled: false,
    departmentId: Number.NaN,
    ownerId: 99,
    includeSensitive: true,
    pageSize: 999999,
  });
  assert.deepEqual(await listBulkJobs(), []);
});

test("下载仅接受 CSV 正文，成功状态中的错误 JSON 也不能保存成文件", async () => {
  globalThis.fetch = async (input) => {
    assert.ok(input instanceof Request);
    assert.equal(new URL(input.url).pathname, "/api/bulk/jobs/43/download");
    return Response.json({ success: false, message: "权限已撤销" });
  };
  await assert.rejects(
    downloadBulkResult(43, "users.csv"),
    (error: unknown) =>
      error instanceof ApiError && error.message.includes("文件响应类型异常"),
  );
});
