import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryHref,
  positiveInteger,
  portalReturnPath,
  legacyCategoryHref,
  channelHref,
  isPortalPath,
} from "../frontend/src/lib/portal-routing.ts";

test("栏目导航使用独立路径，旧书签保留搜索和页码并丢弃无关参数", () => {
  assert.equal(categoryHref(28), "/categories/28");
  assert.equal(
    legacyCategoryHref("?category=28&q=权限&page=2&redirect=/admin"),
    "/categories/28?q=%E6%9D%83%E9%99%90&page=2",
  );
  assert.equal(legacyCategoryHref("?tag=12"), null);
});

test("栏目路径与内部分类分离，频道书签和主题作用域只接受前台路径", () => {
  assert.equal(channelHref("guides", 28), "/channels/guides?category=28");
  assert.equal(channelHref("updates"), "/channels/updates");
  const from = "/channels/guides?category=28&q=test&page=2";
  assert.equal(portalReturnPath({ from }), from);
  for (const path of ["/", "/channels/guides", "/articles/1", "/categories/28"])
    assert.equal(isPortalPath(path), true);
  for (const path of [
    "/admin",
    "/login",
    "/admin/portal",
    "/channels/guides/../../admin",
  ])
    assert.equal(isPortalPath(path), false);
});
test("错误栏目不回退成首页全部文章", () => {
  for (const invalid of [
    "0",
    "-1",
    "abc",
    "1.5",
    "1e2",
    "",
    "9999999999999999",
  ]) {
    assert.match(
      legacyCategoryHref(`?category=${invalid}`),
      /^\/categories\/unavailable/,
    );
    assert.equal(positiveInteger(invalid), undefined);
  }
  assert.equal(positiveInteger("2", 1), 2);
  assert.equal(positiveInteger("NaN", 1), 1);
});
test("详情可返回原栏目并恢复搜索、分页，首页来源保持兼容", () => {
  for (const from of [
    "/",
    "/?q=权限&page=2",
    "/categories/28",
    "/categories/30?tag=5&q=test&page=2",
  ]) {
    assert.equal(portalReturnPath({ from }), from);
  }
});
test("返回目标拒绝外链、后台、路径穿越、反斜线和非文章列表", () => {
  for (const from of [
    "//example.com",
    "https://example.com",
    "/admin",
    "/categories/1/../../admin",
    "/categories/1\\admin",
    "/categories/0",
    "/categories/2147483648",
    "/categories/%32",
    "/articles/1",
    "/\n/admin",
    null,
    1,
  ]) {
    assert.equal(portalReturnPath({ from }), "/");
  }
  assert.equal(portalReturnPath(null), "/");
});
