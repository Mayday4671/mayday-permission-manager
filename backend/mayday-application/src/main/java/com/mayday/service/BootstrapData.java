package com.mayday.service;

import com.mayday.content.ContentPublication;
import com.mayday.content.ContentPublicationRepository;
import com.mayday.content.ContentRevision;
import com.mayday.content.ContentRevisionRepository;
import com.mayday.content.Notice;
import com.mayday.content.NoticeRepository;
import com.mayday.security.PermissionCatalog;
import com.mayday.system.model.DictionaryItem;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import com.mayday.system.model.SystemEntry;
import com.mayday.system.repository.DictionaryItemRepository;
import com.mayday.system.repository.EntryRepository;
import com.mayday.system.repository.RoleRepository;
import com.mayday.system.repository.UserRepository;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 首次启动初始化，默认只建立管理员与必要基础资料，便于直接复用于新项目。 SEED_DEMO_DATA=true 才建立演示组织、普通角色、人员和文章；只在初始 admin 不存在时执行。
 * 两种模式均为同一事务，已有账号密码与权限不被重启覆盖，切换开关不会清理或追加既有业务数据。
 */
@Component
@RequiredArgsConstructor
public class BootstrapData implements CommandLineRunner {
  private final UserRepository users;
  private final RoleRepository roles;
  private final EntryRepository entries;
  private final DictionaryItemRepository dictionaryItems;
  private final NoticeRepository notices;
  private final ContentRevisionRepository revisions;
  private final ContentPublicationRepository publications;
  private final PasswordEncoder encoder;
  private final PortalStructureService portal;

  @Value("${mayday.admin-password}")
  private String password;

  @Value("${mayday.seed-demo-data:false}")
  private boolean seedDemoData;

  @Override
  @Transactional
  public void run(String... args) {
    if (users.findByUsername("admin").isPresent()) return;
    UserService.validatePassword(password);
    SysRole admin = role("admin", "超级管理员", "完整管理权限，内置角色受保护", PermissionCatalog.ALL, "ALL");
    if (!seedDemoData) {
      initializeClean(admin);
      portal.initializeCategories();
      return;
    }
    SysRole editor =
        role(
            "editor",
            "内容运营",
            "负责本部门内容的撰写、维护与发布",
            Set.of(
                "dashboard:view",
                "notices:view",
                "notices:create",
                "notices:update",
                "notices:delete",
                "notices:publish"),
            "DEPARTMENT");
    SysRole member =
        role(
            "member",
            "团队成员",
            "可以查看本人资料与撰写个人草稿",
            Set.of(
                "dashboard:view", "users:view", "notices:view", "notices:create", "notices:update"),
            "SELF");
    SystemEntry company = entry("departments", "Mayday 工作室", "mayday", null, "连接团队与每一种可能", 0);
    SystemEntry product =
        entry("departments", "产品设计部", "product", company.getId(), "创造简单、好用的产品体验", 1);
    SystemEntry engineering =
        entry("departments", "研发中心", "engineering", company.getId(), "平台开发与技术支持", 2);
    SystemEntry operations =
        entry("departments", "内容运营部", "operations", company.getId(), "内容建设与品牌运营", 3);
    SysUser owner =
        user("admin", "管理员", "admin@mayday.example", engineering.getId(), admin, password);
    user(
        "lin.yue".replace('.', '_'),
        "林悦",
        "lin.yue@mayday.example",
        product.getId(),
        member,
        UUID.randomUUID().toString());
    user(
        "chen_yu",
        "陈宇",
        "chen.yu@mayday.example",
        engineering.getId(),
        member,
        UUID.randomUUID().toString());
    user(
        "zhou_mo",
        "周末",
        "zhou.mo@mayday.example",
        operations.getId(),
        editor,
        UUID.randomUUID().toString());
    user(
        "xu_an",
        "许安",
        "xu.an@mayday.example",
        operations.getId(),
        editor,
        UUID.randomUUID().toString());
    user(
        "jiang_nan",
        "江南",
        "jiang.nan@mayday.example",
        product.getId(),
        member,
        UUID.randomUUID().toString());
    String[][] nav = {
      {"工作台", "dashboard", "/admin"},
      {"用户管理", "users", "/admin/users"},
      {"角色权限", "roles", "/admin/roles"},
      {"组织部门", "departments", "/admin/departments"},
      {"菜单管理", "menus", "/admin/menus"},
      {"内容中心", "notices", "/admin/notices"},
      {"数据字典", "dictionaries", "/admin/dictionaries"},
      {"系统参数", "settings", "/admin/settings"},
      {"操作日志", "logs", "/admin/logs"}
    };
    for (int i = 0; i < nav.length; i++) {
      SystemEntry menu = entry("menus", nav[i][0], nav[i][1], null, "系统内置导航", i);
      menu.setPath(nav[i][2]);
      menu.setPermission(nav[i][1] + ":view");
      entries.save(menu);
    }
    var categoryDictionary = entry("dictionaries", "内容分类", "content.category", null, "历史内容分类字典", 1);
    categoryDictionary.setValue("公告,产品动态,团队故事,使用指南");
    int categoryOrder = 0;
    for (String category : List.of("公告", "产品动态", "团队故事", "使用指南")) {
      dictionaryItem(categoryDictionary, category, category, categoryOrder);
      entry("categories", category, "category_" + categoryOrder, null, "", categoryOrder++);
    }
    var userStatus = entry("dictionaries", "账号状态", "user.status", null, "统一的账号状态字典", 2);
    userStatus.setValue("启用,停用");
    dictionaryItem(userStatus, "启用", "true", 0);
    dictionaryItem(userStatus, "停用", "false", 1);
    entry("settings", "平台名称", "site.name", null, "应用展示名称；业务扩展可通过参数服务读取", 1).setValue("Mayday");
    entry("settings", "联系邮箱", "site.contact", null, "公开联络方式，请勿在参数表保存密钥", 2)
        .setValue("hello@mayday.example");
    portal.initializeCategories();
    article(
        owner,
        "你好，Mayday。让每一份协作都有回响。",
        "产品动态",
        "一个连接团队、内容与业务的新起点。欢迎来到更有秩序的工作空间。",
        true,
        "好的协作，始于一个清晰的工作空间。\n\n"
            + "Mayday 将团队管理、权限配置和内容发布放在一起，让日常工作更轻松。你可以邀请同事、规划组织结构，也可以把团队的最新动态分享给更多人。\n\n"
            + "从今天开始，把时间留给真正重要的事。\n\n"
            + "这是一篇初始化示例内容，可以在后台「内容中心」中编辑、撤回或删除。");
    article(
        owner,
        "让权限恰到好处，让协作自由发生",
        "使用指南",
        "从角色到操作，从部门到个人，了解 Mayday 的精细权限体系。",
        true,
        "权限不应该只有管理员与普通用户两种选择。\n\n"
            + "在角色权限中，你可以为每个模块分别授权查看、新增、编辑和删除。敏感字段、数据导出、密码重置与内容发布也具有独立权限。\n\n"
            + "数据范围进一步决定成员能够操作哪些记录：本人、本部门、部门及下级，或全部数据。所有限制同时作用于页面与后端接口。\n\n"
            + "初始化示例：请根据自己的组织结构调整角色后再邀请成员。");
    article(
        owner,
        "把灵感变成作品：我们的协作日常",
        "团队故事",
        "不同的角色，相同的热爱。记录那些让团队向前的瞬间。",
        true,
        "每个好的想法，都值得被认真对待。\n\n"
            + "从一张草图到一次讨论，从第一行代码到上线发布，协作的价值藏在每一次认真反馈里。\n\n"
            + "在这里，你可以记录项目进展、分享经验，也可以为同事留下一个新的灵感。\n\n"
            + "这是一篇可替换的团队故事示例。");
    article(
        owner,
        "Mayday 工作空间使用说明",
        "公告",
        "开始之前，花三分钟了解平台的主要功能与使用路径。",
        true,
        "欢迎使用 Mayday。\n\n"
            + "1. 在个人中心更新你的昵称与联系方式。\n"
            + "2. 管理员在用户管理中创建成员并分配角色。\n"
            + "3. 在角色权限中选择模块操作和数据范围。\n"
            + "4. 内容中心保存草稿或发布，已发布内容会展示在前台门户。\n"
            + "5. 所有写入操作均可在操作日志中追踪。\n\n"
            + "请在首次使用后更换管理员密码。");
    article(
        owner,
        "下一次更新，从你的反馈开始",
        "产品动态",
        "收集使用中的观察，持续改善工作体验。",
        false,
        "这是一篇草稿，只有拥有相应数据权限的成员可以在后台查看。\n\n在准备好内容之后，由具有发布权限的成员勾选「发布到前台」。");
  }

  /**
   * 新项目模式不依赖演示部门、成员或文章。迁移已创建的菜单保留，仅补齐当前页面目录中的缺项。 分类和账号状态属于可编辑的基础资料，不会创建任何公开文章；管理员可在首次登录后设置组织及网站信息。
   */
  private void initializeClean(SysRole admin) {
    user("admin", "管理员", null, null, admin, password);
    Set<String> existingMenus = new HashSet<>();
    entries
        .findByKindOrderBySortOrderAscIdAsc("menus")
        .forEach(menu -> existingMenus.add(menu.getCode()));
    int order = 0;
    for (var page : NavigationCatalog.PAGES) {
      if (existingMenus.contains(page.code())) continue;
      SystemEntry menu = entry("menus", page.name(), page.code(), null, "系统内置导航", order++);
      menu.setPath(page.path());
      menu.setPermission(page.permission());
      entries.save(menu);
    }
    var status = entry("dictionaries", "账号状态", "user.status", null, "账号启用状态；与 enabled 布尔字段对应", 0);
    status.setValue("启用,停用");
    dictionaryItem(status, "启用", "true", 0);
    dictionaryItem(status, "停用", "false", 1);
    int categoryOrder = 0;
    for (String name : List.of("公告", "产品动态", "团队故事", "使用指南"))
      entry(
          "categories", name, "category_" + categoryOrder, null, "初始内容分类，可按业务调整", categoryOrder++);
    entry("settings", "平台名称", "site.name", null, "对外展示名称，请在网站配置中调整", 0).setValue("Mayday");
  }

  private SysRole role(
      String code, String name, String description, Set<String> permissions, String scope) {
    SysRole r = new SysRole();
    r.setCode(code);
    r.setName(name);
    r.setDescription(description);
    r.setPermissions(new HashSet<>(permissions));
    r.setDataScopes(new HashMap<>(Map.of("users", scope, "notices", scope)));
    return roles.save(r);
  }

  private void dictionaryItem(SystemEntry dictionary, String label, String value, int order) {
    var item = new DictionaryItem();
    item.setDictionaryId(dictionary.getId());
    item.setLabel(label);
    item.setValue(value);
    item.setSortOrder(order);
    dictionaryItems.save(item);
  }

  private SystemEntry entry(
      String kind, String name, String code, Long parent, String description, int sort) {
    SystemEntry e = new SystemEntry();
    e.setKind(kind);
    e.setName(name);
    e.setCode(code);
    e.setParentId(parent);
    e.setDescription(description);
    e.setSortOrder(sort);
    if ("settings".equals(kind) && SettingService.SITE_KEYS.containsKey(code)) {
      e.setGroupName("网站");
      e.setBuiltIn(true);
      e.setValueType(SettingService.SITE_KEYS.get(code).type());
    }
    return entries.save(e);
  }

  private SysUser user(
      String username,
      String nickname,
      String email,
      Long department,
      SysRole role,
      String password) {
    SysUser u = new SysUser();
    u.setUsername(username);
    u.setNickname(nickname);
    u.setEmail(email);
    u.setDepartmentId(department);
    u.setPasswordHash(encoder.encode(password));
    u.setRoles(new HashSet<>(Set.of(role)));
    return users.save(u);
  }

  private void article(
      SysUser owner,
      String title,
      String category,
      String summary,
      boolean published,
      String content) {
    Notice n = new Notice();
    n.setTitle(title);
    n.setCategory(category);
    n.setSummary(summary);
    n.setContent(content);
    n.setPublished(published);
    n.setAuthorId(owner.getId());
    n.setDepartmentId(owner.getDepartmentId());
    n.setAuthorName("Mayday 团队");
    notices.saveAndFlush(n);
    var r = new ContentRevision();
    r.setNoticeId(n.getId());
    r.setRevisionNumber(1);
    r.setTitle(title);
    r.setSummary(summary);
    r.setContent(com.mayday.common.RichText.plain(content, 50000));
    r.setCategoryId(
        entries.findByKindOrderBySortOrderAscIdAsc("categories").stream()
            .filter(e -> e.getName().equals(category))
            .findFirst()
            .orElseThrow()
            .getId());
    r.setEditorId(owner.getId());
    r.setPortalChannelId(portal.contentChannel(r.getCategoryId(), null));
    r.setEditorName(owner.getNickname());
    revisions.saveAndFlush(r);
    n.setDraftRevisionId(r.getId());
    if (published) {
      n.setLiveRevisionId(r.getId());
      n.setDraftStatus("PUBLISHED");
      n.setPublishedAt(java.time.LocalDateTime.now());
      var p = new ContentPublication();
      p.setNoticeId(n.getId());
      p.setRevisionId(r.getId());
      p.setPublishedAt(n.getPublishedAt());
      p.setOperatorName(owner.getNickname());
      p.setReason("初始化示例");
      publications.save(p);
    }
  }
}
