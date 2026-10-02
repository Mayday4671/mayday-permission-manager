/**
 * 文件 DELETE 现在是回收操作，测试必须等待持久化清理完成后才能核对数据库基线。
 * 仅允许随机隔离验证项目，且仅处理测试成功创建并登记的文件 ID，不清空整张表或存储目录。
 */
import assert from "node:assert/strict";

/** 回收并永久清理精确测试文件，确认记录实际消失；存储失败或超时必须使验收失败。 */
export async function purgeTestFiles(base, token, identifiers) {
  const ids = [...new Set(identifiers)];
  if (!ids.length) return;
  assert(ids.every((id) => Number.isSafeInteger(id) && id > 0));
  assert(
    /^mayday-check-\d+-[a-f0-9]{6}$/.test(
      process.env.API_TEST_COMPOSE_PROJECT ?? "",
    ) && ["fresh-db", "upgrade-db"].includes(process.env.API_TEST_DATABASE),
    "文件永久清理只允许本次独立验收项目",
  );
  assert.equal(
    base,
    process.env.API_BASE,
    "清理地址必须与本次隔离验收的 API 地址一致",
  );
  const request = async (path, method = "GET", data, allowMissing = false) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (
      allowMissing &&
      response.status === 400 &&
      body.message === "文件不存在"
    )
      return null;
    assert.equal(response.status, 200, `测试文件清理 ${method} ${path} 失败`);
    assert.equal(body.success, true);
    return body.data;
  };
  const toPurge = [];
  for (const id of ids) {
    const file = await request(
      `/operations/files/${id}`,
      "GET",
      undefined,
      true,
    );
    if (!file || file.purgeRequestedAt) continue;
    if (!file.deletedAt) await request(`/operations/files/${id}`, "DELETE");
    toPurge.push(id);
  }
  for (let offset = 0; offset < toPurge.length; offset += 100)
    await request("/operations/files/batch", "POST", {
      action: "PURGE",
      ids: toPurge.slice(offset, offset + 100),
    });
  // 后台每轮最多清理十条；下载已被禁止并不代表元信息和对象都已完成删除。
  const deadline = Date.now() + 90000 + Math.ceil(ids.length / 10) * 30000;
  while (Date.now() < deadline) {
    let remaining = 0;
    for (const id of ids) {
      const file = await request(
        `/operations/files/${id}`,
        "GET",
        undefined,
        true,
      );
      if (file) {
        assert(!file.purgeError, `测试文件 ${id} 外部存储清理失败`);
        remaining++;
      }
    }
    if (!remaining) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("测试文件持久化清理超时，请检查独立验证库和存储服务");
}
