/** 门户栏目与分类独立、公开资源隔离、首页编排及并发版本的真实 MySQL 验收；只允许独立验证库。 */
import { isolatedSql } from "./support/isolated-compose.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { loginWithCaptcha } from "./support/captcha.mjs";
const base = process.env.API_BASE;
const isolated =
  /^mayday-check-\d+-[a-f0-9]{6}$/.test(
    process.env.API_TEST_COMPOSE_PROJECT ?? "",
  ) &&
  ["upgrade-db", "fresh-db"].includes(process.env.API_TEST_DATABASE) &&
  !!base;
function sql(statement) {
  assert(isolated, "SQL 仅允许本次独立验收项目");
  return isolatedSql(statement, { raw: true }).trim();
}
async function call(path, token, method = "GET", data, status = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(body)}`,
  );
  return body.data;
}
test("门户栏目、分类、编排的真实数据库边界", { skip: !isolated }, async (t) => {
  const admin = (
    await loginWithCaptcha(base, "admin", process.env.ADMIN_PASSWORD)
  ).token;
  const prefix = "portal" + Date.now();
  const made = {
    categories: [],
    channels: [],
    articles: [],
    users: [],
    roles: [],
    files: [],
  };
  const homeFields = [
    "id",
    "created_at",
    "updated_at",
    "version",
    "hero_article_id",
    "notice_article_id",
    "featured_article_ids",
    "allow_theme_toggle",
    "night_primary_color",
  ];
  const oldHome = JSON.parse(
    sql(
      `SELECT JSON_ARRAY(${homeFields.map((f) => `HEX(CAST(${f} AS CHAR CHARACTER SET utf8mb4))`).join(",")}) FROM cms_portal_home WHERE id=1;`,
    ),
  );
  let first,
    second,
    category,
    other,
    article,
    cover,
    attachment,
    viewer,
    optionNotice;
  const draft = (c, extra = {}) => ({
    title: prefix,
    categoryId: c.id,
    content: "<h2>操作说明</h2><p>真正的公开正文</p>",
    contentFormat: "HTML",
    visibility: "PUBLIC",
    tagIds: [],
    attachmentIds: [],
    ...extra,
  });
  const channelDraft = (code, ids, template = "GUIDE") => ({
    code,
    name: prefix + code,
    template,
    description: "独立验收用途",
    sortOrder: 500,
    enabled: true,
    categoryIds: ids,
  });
  const remember = async (resource, value) => {
    const result = await call(
      `/system/entries/${resource}`,
      admin,
      "POST",
      value,
    );
    made.categories.push(result.id);
    return result;
  };
  try {
    category = await remember("categories", {
      name: prefix,
      code: prefix,
      enabled: true,
      sortOrder: 0,
    });
    other = await remember("categories", {
      name: prefix + "2",
      code: prefix + "2",
      enabled: true,
      sortOrder: 1,
    });
    await t.test("未绑定分类不能写内容；新分类不会自动创建导航", async () => {
      await call("/content/notices", admin, "POST", draft(category), 400);
      assert(
        !(await call("/public/site")).channels.some(
          (c) => c.name === category.name,
        ),
      );
    });
    first = await call(
      "/portal-management/channels",
      admin,
      "POST",
      channelDraft(prefix + "a", [category.id, other.id]),
    );
    made.channels.push(first.id);
    second = await call(
      "/portal-management/channels",
      admin,
      "POST",
      channelDraft(prefix + "b", [], "NOTICE"),
    );
    made.channels.push(second.id);
    await t.test(
      "一个栏目可包含多个分类，分类不能同时分配给另一栏目",
      async () => {
        assert.deepEqual(
          first.categories.map((c) => c.id),
          [category.id, other.id],
        );
        await call(
          `/portal-management/channels/${second.id}`,
          admin,
          "PUT",
          {
            ...channelDraft(second.code, [category.id], "NOTICE"),
            version: second.version,
          },
          400,
        );
        await call(
          "/content/notices",
          admin,
          "POST",
          draft(category, { portalChannelId: second.id }),
          400,
        );
      },
    );
    await t.test("只改变分类顺序也递增版本，旧弹窗不能覆盖新次序", async () => {
      const old = first;
      first = await call(
        `/portal-management/channels/${first.id}`,
        admin,
        "PUT",
        {
          ...channelDraft(first.code, [other.id, category.id]),
          version: first.version,
        },
      );
      assert(first.version > old.version);
      assert.deepEqual(
        first.categories.map((c) => c.id),
        [other.id, category.id],
      );
      await call(
        `/portal-management/channels/${first.id}`,
        admin,
        "PUT",
        {
          ...channelDraft(first.code, [category.id, other.id]),
          version: old.version,
        },
        409,
      );
    });
    const upload = async (name, bytes) => {
      const body = new FormData();
      body.append("file", new Blob([bytes]), name);
      const response = await fetch(base + "/operations/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${admin}` },
        body,
      });
      assert.equal(response.status, 200);
      const result = (await response.json()).data;
      made.files.push(result.id);
      return result;
    };
    cover = await upload(
      prefix + ".png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    attachment = await upload(prefix + ".txt", "公开附件");
    article = await call(
      "/content/notices",
      admin,
      "POST",
      draft(category, {
        portalChannelId: first.id,
        coverId: cover.id,
        attachmentIds: [attachment.id],
        recommended: true,
      }),
    );
    made.articles.push(article.id);
    article = await call(
      `/content/notices/${article.id}/publish`,
      admin,
      "POST",
      { version: article.version, revisionId: article.revisionId },
    );
    await t.test(
      "栏目过滤在 SQL 分页层生效，直接栏目查询不会混入其他栏目",
      async () => {
        const result = await call(
          `/public/articles?channel=${first.code}&categoryId=${category.id}`,
        );
        assert.deepEqual(
          result.items.map((a) => a.id),
          [article.id],
        );
        assert.equal(result.items[0].channelCode, first.code);
        assert.equal(
          (
            await call(
              `/public/articles?channel=${second.code}&categoryId=${category.id}`,
            )
          ).total,
          0,
        );
        await call(
          "/public/articles?channel=unknown-portal",
          null,
          "GET",
          undefined,
          404,
        );
      },
    );
    await t.test(
      "历史修订使用稳定归属，已有内容的分类不能移出栏目",
      async () => {
        await call(
          `/portal-management/channels/${first.id}`,
          admin,
          "PUT",
          { ...channelDraft(first.code, [other.id]), version: first.version },
          400,
        );
        await call(
          `/portal-management/channels/${first.id}?version=${first.version}`,
          admin,
          "DELETE",
          undefined,
          400,
        );
      },
    );
    await t.test("大量其他栏目新内容不能挤出自动主视觉和公告条", async () => {
      const noticeCategory = await remember("categories", {
        name: prefix + "notice",
        code: prefix + "notice",
        enabled: true,
        sortOrder: 0,
      });
      second = await call(
        `/portal-management/channels/${second.id}`,
        admin,
        "PUT",
        {
          ...channelDraft(second.code, [noticeCategory.id], "NOTICE"),
          version: second.version,
        },
      );
      const updateCategory = await remember("categories", {
        name: prefix + "update",
        code: prefix + "update",
        enabled: true,
        sortOrder: 0,
      });
      const updateChannel = await call(
        "/portal-management/channels",
        admin,
        "POST",
        channelDraft(prefix + "u", [updateCategory.id], "UPDATE"),
      );
      made.channels.push(updateChannel.id);
      for (let index = 0; index < 14; index++) {
        const target = index === 0 ? noticeCategory : updateCategory;
        let entry = await call(
          "/content/notices",
          admin,
          "POST",
          draft(target, {
            title: prefix + "首页边界" + index,
            recommended: true,
            pinned: true,
          }),
        );
        made.articles.push(entry.id);
        const published = await call(
          `/content/notices/${entry.id}/publish`,
          admin,
          "POST",
          {
            version: entry.version,
            revisionId: entry.revisionId,
          },
        );
        if (index === 0) optionNotice = published;
      }
      const original = await call("/portal-management/home", admin);
      await call("/portal-management/home", admin, "PUT", {
        ...original,
        heroArticleId: null,
        noticeArticleId: null,
        featuredArticleIds: [],
      });
      const automatic = await call("/public/home");
      assert.equal(automatic.hero.channelTemplate, "GUIDE");
      assert.equal(automatic.notice.channelTemplate, "NOTICE");
      assert.equal(automatic.featured.length, 3);
      assert(
        automatic.featured.every(
          (entry) => entry.channelCode === updateChannel.code,
        ),
      );
    });
    await t.test(
      "首页选项按线上标题和栏目搜索，未发布草稿不改变公告归属",
      async () => {
        const liveTitle = optionNotice.title;
        optionNotice = await call(
          `/content/notices/${optionNotice.id}`,
          admin,
          "PUT",
          {
            ...draft(other, { title: prefix + "改名后的指南草稿" }),
            version: optionNotice.version,
          },
        );
        assert.equal(optionNotice.portalChannelId, first.id);
        assert.equal(optionNotice.livePortalChannelId, second.id);
        assert.equal(optionNotice.liveTitle, liveTitle);
        const selected = await call(
          `/content/notices?publiclyVisible=true&portalTemplate=NOTICE&keyword=${encodeURIComponent(liveTitle)}&size=100`,
          admin,
        );
        assert(selected.items.some((entry) => entry.id === optionNotice.id));
        const wrongTemplate = await call(
          `/content/notices?publiclyVisible=true&portalTemplate=GUIDE&keyword=${encodeURIComponent(liveTitle)}&size=100`,
          admin,
        );
        assert(
          !wrongTemplate.items.some((entry) => entry.id === optionNotice.id),
        );
        assert.equal(
          (await call(`/public/articles/${optionNotice.id}`)).channelTemplate,
          "NOTICE",
        );
      },
    );
    await t.test(
      "首页只能选择公开文章，公告条拒绝指南，编排顺序与版本真实保存",
      async () => {
        const old = await call("/portal-management/home", admin);
        await call(
          "/portal-management/home",
          admin,
          "PUT",
          { ...old, noticeArticleId: article.id },
          400,
        );
        const saved = await call("/portal-management/home", admin, "PUT", {
          ...old,
          heroArticleId: article.id,
          noticeArticleId: null,
          featuredArticleIds: [article.id],
          allowThemeToggle: false,
          nightPrimaryColor: "#53d5be",
        });
        await call(
          "/portal-management/home",
          admin,
          "PUT",
          { ...old, featuredArticleIds: [article.id] },
          409,
        );
        assert(saved.version > old.version);
        const publicHome = await call("/public/home");
        assert.equal(publicHome.hero.id, article.id);
        assert.deepEqual(
          publicHome.featured.map((a) => a.id),
          [article.id],
        );
        assert.equal((await call("/public/site")).allowThemeToggle, false);
      },
    );
    await t.test(
      "停用栏目同时关闭正文、封面与附件，首页不泄露已选私有 ID",
      async () => {
        first = await call(
          `/portal-management/channels/${first.id}`,
          admin,
          "PUT",
          {
            ...channelDraft(first.code, [other.id, category.id]),
            enabled: false,
            version: first.version,
          },
        );
        assert(
          !(await call("/public/site")).channels.some((c) => c.id === first.id),
        );
        for (const path of [
          `/public/articles/${article.id}`,
          `/public/articles/${article.id}/cover`,
          `/public/articles/${article.id}/files/${attachment.id}`,
        ]) {
          const response = await fetch(base + path);
          assert.equal(response.status, 404, path);
        }
        const home = await call("/public/home");
        assert.equal(home.hero, null);
        assert.deepEqual(home.featured, []);
        await call(
          "/public/articles?channel=" + first.code,
          null,
          "GET",
          undefined,
          404,
        );
        first = await call(
          `/portal-management/channels/${first.id}`,
          admin,
          "PUT",
          {
            ...channelDraft(first.code, [other.id, category.id]),
            version: first.version,
          },
        );
      },
    );
    await t.test(
      "停用分类也关闭公开正文及文件；恢复不丢失历史版本",
      async () => {
        let cat = (
          await call("/system/entries/categories?size=100", admin)
        ).items.find((c) => c.id === category.id);
        await call(`/system/entries/categories/${category.id}`, admin, "PUT", {
          ...cat,
          enabled: false,
        });
        await call(
          `/public/articles/${article.id}`,
          null,
          "GET",
          undefined,
          404,
        );
        cat = (
          await call("/system/entries/categories?size=100", admin)
        ).items.find((c) => c.id === category.id);
        await call(`/system/entries/categories/${category.id}`, admin, "PUT", {
          ...cat,
          enabled: true,
        });
        assert.equal(
          (await call(`/public/articles/${article.id}`)).channelCode,
          first.code,
        );
      },
    );
    const role = await call("/system/roles", admin, "POST", {
      name: prefix,
      code: prefix,
      enabled: true,
      permissions: ["notices:view", "portal:view", "portal:update"],
      dataScopes: { notices: "SELF" },
    });
    made.roles.push(role.id);
    const user = await call("/system/users", admin, "POST", {
      username: prefix,
      nickname: prefix,
      enabled: true,
      roleIds: [role.id],
      password: "Portal_Test2026!",
    });
    made.users.push(user.id);
    viewer = (await loginWithCaptcha(base, prefix, "Portal_Test2026!")).token;
    await t.test(
      "栏目写权限与内容范围独立；自有内容范围不能选择管理员文章，不能新增栏目",
      async () => {
        await call(
          "/portal-management/channels",
          viewer,
          "POST",
          channelDraft(prefix + "c", []),
          403,
        );
        const current = await call("/portal-management/home", admin);
        await call(
          "/portal-management/home",
          viewer,
          "PUT",
          {
            ...current,
            heroArticleId: article.id,
            featuredArticleIds: [article.id],
          },
          403,
        );
        const policy = await call(
          "/portal-management/theme-policy",
          viewer,
          "PUT",
          {
            version: current.version,
            allowThemeToggle: true,
            nightPrimaryColor: "#53d5be",
          },
        );
        assert.equal(policy.heroArticleId, current.heroArticleId);
        assert.deepEqual(policy.featuredArticleIds, current.featuredArticleIds);
        assert.equal(policy.allowThemeToggle, true);
        await call(
          "/portal-management/theme-policy",
          viewer,
          "PUT",
          {
            version: current.version,
            allowThemeToggle: false,
            nightPrimaryColor: "#53d5be",
          },
          409,
        );
        await call("/portal-management/channels", null, "GET", undefined, 401);
      },
    );
  } finally {
    const errors = [];
    const clean = async (action) => {
      try {
        await action();
      } catch (error) {
        errors.push(error);
      }
    };
    if (viewer) await clean(() => call("/auth/logout", viewer, "POST"));
    // 只在已验证的隔离项目恢复完整原配置行，包括乐观锁与时间；日常数据库不会参与这些写入。
    await clean(async () => {
      const literals = oldHome.map((value) =>
        value === null ? "NULL" : `CONVERT(UNHEX('${value}') USING utf8mb4)`,
      );
      assert(oldHome.every((v) => v === null || /^[A-F0-9]*$/.test(v)));
      sql(
        `UPDATE cms_portal_home SET ${homeFields.map((field, i) => `${field}=${literals[i]}`).join(",")} WHERE id=1;`,
      );
    });
    for (const id of made.articles.reverse())
      await clean(async () => {
        await call(`/content/notices/${id}`, admin, "DELETE");
        await call(`/content/notices/${id}/purge`, admin, "DELETE");
      });
    const { purgeTestFiles } = await import("./support/files-cleanup.mjs");
    await clean(() => purgeTestFiles(base, admin, made.files));
    for (const id of made.categories.reverse())
      await clean(() =>
        call(`/system/entries/categories/${id}`, admin, "DELETE"),
      );
    for (const id of made.channels.reverse())
      await clean(async () => {
        const current = (await call("/portal-management/channels", admin)).find(
          (c) => c.id === id,
        );
        await call(
          `/portal-management/channels/${id}?version=${current.version}`,
          admin,
          "DELETE",
        );
      });
    for (const id of made.users.reverse())
      await clean(() => call(`/system/users/${id}`, admin, "DELETE"));
    for (const id of made.roles.reverse())
      await clean(() => call(`/system/roles/${id}`, admin, "DELETE"));
    await clean(() => call("/auth/logout", admin, "POST"));
    if (errors.length) throw new AggregateError(errors, "门户验收数据清理失败");
  }
});
