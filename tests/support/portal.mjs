import assert from "node:assert/strict";

/** 内容测试显式登记临时栏目，不依赖生产默认栏目或按分类名称猜测归属；清理时先删除内容及分类。 */
export async function bindTestPortalCategory(base, token, category) {
  const response = await fetch(`${base}/portal-management/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      code: `qa-${category.id}-${Date.now()}`,
      name: "内容测试栏目",
      template: "GUIDE",
      description: "独立验收临时栏目",
      sortOrder: 9999,
      enabled: true,
      categoryIds: [category.id],
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.data;
}

/** 删除临时栏目仍经过实际版本和历史引用检查，不使用直接 SQL 绕过业务清理。 */
export async function deleteTestPortalChannel(base, token, channel) {
  const response = await fetch(
    `${base}/portal-management/channels/${channel.id}?version=${channel.version}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 200, await response.text());
}
