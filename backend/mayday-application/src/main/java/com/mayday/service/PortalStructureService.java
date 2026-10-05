package com.mayday.service;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.content.ContentRevisionRepository;
import com.mayday.content.NoticeRepository;
import com.mayday.content.PortalCategory;
import com.mayday.content.PortalCategoryRepository;
import com.mayday.content.PortalChannel;
import com.mayday.content.PortalChannelRepository;
import com.mayday.content.PortalHomeRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.EntryRepository;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** 门户导航、分类归属与首页编排的统一边界。栏目和分类不互相生成；内容归属冻结在修订中。 管理动作独立授权、校验原版本；涉及内容的选择另核验作者/部门范围。公开查询只返回启用配置。 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PortalStructureService {
  private final PortalChannelRepository channels;
  private final PortalCategoryRepository categories;
  private final PortalHomeRepository homes;
  private final EntryRepository entries;
  private final ContentRevisionRepository revisions;
  private final NoticeRepository notices;
  private final AccessPolicy access;
  private final JsonMapper json;

  /** 仅首次账号初始化调用：建立初始资料的归属；已有账号启动不会执行此方法或重写运营配置。 */
  @Transactional
  public void initializeCategories() {
    for (var entry : entries.findByKindOrderBySortOrderAscIdAsc("categories")) {
      if (categories.existsById(entry.getId())) continue;
      String code =
          switch (entry.getName()) {
            case "使用指南" -> "guides";
            case "公告" -> "notices";
            case "产品动态" -> "updates";
            default -> "stories";
          };
      var binding = new PortalCategory();
      binding.setCategoryId(entry.getId());
      binding.setChannelId(channels.findByCode(code).orElseThrow().getId());
      binding.setSortOrder(entry.getSortOrder());
      categories.save(binding);
    }
    categories.flush();
  }

  /** 栏目输入只接受受支持模板与站内访问名称；分类编号必须真实、唯一且未归属其他栏目。 */
  public record ChannelDraft(
      @NotBlank @Pattern(regexp = "[a-z][a-z0-9-]{0,47}") String code,
      @NotBlank @Size(max = 40) String name,
      @NotNull @Pattern(regexp = "GUIDE|NOTICE|UPDATE|STORY") String template,
      @Size(max = 500) String description,
      @Min(0) @Max(9999) int sortOrder,
      boolean enabled,
      @NotNull @Size(max = 50) List<@NotNull Long> categoryIds,
      Long version) {}

  /** 分类投影同时表达管理启停和顺序，公开入口会剔除停用分类。 */
  public record CategoryView(Long id, String name, boolean enabled) {}

  /** 关联选择器只暴露分类名称与当前归属，不返回系统参数或其他基础资料。 */
  public record CategoryOption(Long id, String name, boolean enabled, Long channelId) {}

  /** 栏目管理者可以选择未绑定分类；已有归属在界面禁选且保存时再次验证。 */
  public List<CategoryOption> categoryOptions() {
    access.require("portal:view");
    return entries.findByKindOrderBySortOrderAscIdAsc("categories").stream()
        .map(
            e ->
                new CategoryOption(
                    e.getId(),
                    e.getName(),
                    e.isEnabled(),
                    categories.findById(e.getId()).map(PortalCategory::getChannelId).orElse(null)))
        .toList();
  }

  /** 管理列表和内容编辑共用栏目结构；不向客户端暴露 JPA 关联或允许修改服务端时间。 */
  public record ChannelView(
      Long id,
      Long version,
      String code,
      String name,
      String template,
      String description,
      int sortOrder,
      boolean enabled,
      List<CategoryView> categories) {}

  /** 首页最多十二个手动精选，顺序保持输入顺序；只有指定内容下线时才在展示时剔除。 */
  public record HomeDraft(
      @NotNull Long version,
      Long heroArticleId,
      Long noticeArticleId,
      @NotNull @Size(max = 12) List<@NotNull Long> featuredArticleIds,
      boolean allowThemeToggle,
      @NotNull @Pattern(regexp = "#[0-9a-fA-F]{6}") String nightPrimaryColor) {}

  /** 配置投影只含受支持的站点编排数据，访客主题偏好不会回写此记录。 */
  public record HomeView(
      Long version,
      Long heroArticleId,
      Long noticeArticleId,
      List<Long> featuredArticleIds,
      boolean allowThemeToggle,
      String nightPrimaryColor) {}

  /** 主题策略单独保存，不重写文章编排，也不要求运营人员重新选择已下线的文章。 */
  public record ThemePolicyDraft(
      @NotNull Long version,
      boolean allowThemeToggle,
      @NotNull @Pattern(regexp = "#[0-9a-fA-F]{6}") String nightPrimaryColor) {}

  private ChannelView view(PortalChannel channel, boolean publicOnly) {
    var items =
        categories.findByChannelIdOrderBySortOrderAscCategoryIdAsc(channel.getId()).stream()
            .map(binding -> entries.findById(binding.getCategoryId()).orElse(null))
            .filter(Objects::nonNull)
            .filter(entry -> !publicOnly || entry.isEnabled())
            .map(entry -> new CategoryView(entry.getId(), entry.getName(), entry.isEnabled()))
            .toList();
    return new ChannelView(
        channel.getId(),
        publicOnly ? null : channel.getVersion(),
        channel.getCode(),
        channel.getName(),
        channel.getTemplate(),
        channel.getDescription(),
        channel.getSortOrder(),
        channel.isEnabled(),
        items);
  }

  /** 管理列表必须拥有栏目查看权限，停用项保留以便恢复，公开列表使用另一个入口。 */
  public List<ChannelView> management() {
    access.require("portal:view");
    return channels.findAllByOrderBySortOrderAscIdAsc().stream().map(c -> view(c, false)).toList();
  }

  /** 编辑者只需内容查看权限即可选择栏目，不能借此获得栏目配置的修改权限。 */
  public List<ChannelView> options() {
    access.require("notices:view");
    return channels.findAllByOrderBySortOrderAscIdAsc().stream().map(c -> view(c, false)).toList();
  }

  /** 匿名目录只输出启用栏目及分类，类别变更不会生成新的导航入口。 */
  public List<ChannelView> publicChannels() {
    return channels.findAllByOrderBySortOrderAscIdAsc().stream()
        .filter(PortalChannel::isEnabled)
        .map(c -> view(c, true))
        .toList();
  }

  /** 查不到栏目即报错；调用方不能省略过滤条件退化为读取全部内容。 */
  public PortalChannel publicChannel(String code) {
    return channels
        .findByCode(code)
        .filter(PortalChannel::isEnabled)
        .orElseThrow(() -> new com.mayday.common.ResourceNotFoundException("栏目不存在或未开放"));
  }

  /** 内容输入的栏目必须与分类绑定完全一致；兼容旧客户端时仅使用已登记的归属，不按名称猜测。 */
  public Long contentChannel(Long categoryId, Long requestedId) {
    var binding =
        categories
            .findById(categoryId)
            .orElseThrow(() -> new BusinessException("此分类尚未配置门户栏目，请先在门户栏目中关联"));
    if (requestedId != null && !requestedId.equals(binding.getChannelId()))
      throw new BusinessException("内容分类不属于所选栏目");
    if (!channels.findById(binding.getChannelId()).orElseThrow().isEnabled())
      throw new BusinessException("所选栏目已停用");
    return binding.getChannelId();
  }

  /** 一次保存栏目和有序分类归属；被历史修订引用的分类不能移走，保护发布快照与旧书签。 */
  @Transactional
  public ChannelView save(Long id, ChannelDraft input) {
    access.require(id == null ? "portal:create" : "portal:update");
    access.require("portal:view");
    homes.lockConfiguration().orElseThrow();
    if (Set.of("admin", "login", "api", "articles", "categories", "channels", "search")
        .contains(input.code())) throw new BusinessException("该访问名称为系统保留名称");
    PortalChannel channel =
        id == null
            ? new PortalChannel()
            : channels.findById(id).orElseThrow(() -> new BusinessException("栏目不存在"));
    if (id != null) {
      UserService.version(channel, input.version());
      if (!channel.getCode().equals(input.code())) throw new BusinessException("已有栏目的访问名称不能修改");
    }
    if (channels.findByCode(input.code()).filter(c -> !Objects.equals(c.getId(), id)).isPresent())
      throw new BusinessException("访问名称已存在");
    if (new HashSet<>(input.categoryIds()).size() != input.categoryIds().size())
      throw new BusinessException("同一栏目不能重复关联分类");
    for (Long categoryId : input.categoryIds()) {
      entries
          .findById(categoryId)
          .filter(e -> "categories".equals(e.getKind()))
          .orElseThrow(() -> new BusinessException("分类不存在"));
      var binding = categories.findById(categoryId);
      if (binding.isPresent() && !Objects.equals(binding.get().getChannelId(), id))
        throw new BusinessException("分类已属于其他栏目，不能重复关联");
    }
    if (id != null)
      for (var binding : categories.findByChannelIdOrderBySortOrderAscCategoryIdAsc(id)) {
        if (!input.categoryIds().contains(binding.getCategoryId())) {
          if (revisions.existsByCategoryId(binding.getCategoryId()))
            throw new BusinessException("分类仍被内容修订引用，不能移出栏目；可在分类管理中停用");
          categories.delete(binding);
        }
      }
    channel.setCode(input.code());
    channel.setName(input.name().trim());
    channel.setTemplate(input.template());
    channel.setDescription(input.description());
    channel.setSortOrder(input.sortOrder());
    channel.setEnabled(input.enabled());
    // 分类次序也是栏目配置；即使基本字段未变，也必须递增版本，防止旧弹窗覆盖另一人的分类调整。
    if (id != null) channel.setUpdatedAt(BusinessTime.now());
    channels.saveAndFlush(channel);
    for (int index = 0; index < input.categoryIds().size(); index++) {
      Long categoryId = input.categoryIds().get(index);
      var binding = categories.findById(categoryId).orElseGet(PortalCategory::new);
      binding.setCategoryId(categoryId);
      binding.setChannelId(channel.getId());
      binding.setSortOrder(index);
      categories.save(binding);
    }
    categories.flush();
    return view(channel, false);
  }

  /** 删除仅针对没有分类和历史内容引用的栏目；可停用而不清空内容及文章版本。 */
  @Transactional
  public void delete(Long id, Long version) {
    access.require("portal:delete");
    access.require("portal:view");
    homes.lockConfiguration().orElseThrow();
    var channel = channels.findById(id).orElseThrow(() -> new BusinessException("栏目不存在"));
    UserService.version(channel, version);
    if (categories.existsByChannelId(id) || revisions.existsByPortalChannelId(id))
      throw new BusinessException("栏目仍有分类或历史内容引用，请停用或先移除无引用分类");
    channels.delete(channel);
  }

  /** 首页配置独立保存版本；缺失种子属于部署错误，不能在匿名读取时创建默认业务数据。 */
  public HomeView home(boolean management) {
    if (management) access.require("portal:view");
    var home = homes.findById(1L).orElseThrow(() -> new BusinessException("首页配置尚未初始化"));
    return new HomeView(
        management ? home.getVersion() : null,
        home.getHeroArticleId(),
        home.getNoticeArticleId(),
        json.readValue(home.getFeaturedArticleIds(), new TypeReference<List<Long>>() {}),
        home.isAllowThemeToggle(),
        home.getNightPrimaryColor());
  }

  private void validateArticle(Long id, boolean notice) {
    if (id == null) return;
    access.require("notices:view");
    var article =
        notices
            .findOne(ContentService.publiclyVisible().and((r, q, c) -> c.equal(r.get("id"), id)))
            .orElseThrow(() -> new BusinessException("只能选择当前已公开上线的内容"));
    access.checkData("notices", article.getAuthorId(), article.getDepartmentId());
    if (notice
        && !"NOTICE"
            .equals(
                revisions
                    .findById(article.getLiveRevisionId())
                    .orElseThrow()
                    .getPortalChannel()
                    .getTemplate())) throw new BusinessException("公告条只能选择公告栏目内容");
  }

  /** 首页推荐不会发布文章；选择范围、上线状态及公告类型均在服务端检查，原配置版本必须匹配。 */
  @Transactional
  public HomeView saveHome(HomeDraft input) {
    access.require("portal:update");
    access.require("portal:view");
    var home = homes.lockConfiguration().orElseThrow();
    UserService.version(home, input.version());
    if (new HashSet<>(input.featuredArticleIds()).size() != input.featuredArticleIds().size())
      throw new BusinessException("精选内容不能重复");
    validateArticle(input.heroArticleId(), false);
    validateArticle(input.noticeArticleId(), true);
    input.featuredArticleIds().forEach(id -> validateArticle(id, false));
    home.setHeroArticleId(input.heroArticleId());
    home.setNoticeArticleId(input.noticeArticleId());
    home.setFeaturedArticleIds(json.writeValueAsString(input.featuredArticleIds()));
    home.setAllowThemeToggle(input.allowThemeToggle());
    home.setNightPrimaryColor(input.nightPrimaryColor().toLowerCase(java.util.Locale.ROOT));
    homes.saveAndFlush(home);
    return home(true);
  }

  /** 只修改访客主题开关和暗夜强调色；使用相同版本锁，避免并发覆盖首页编排。 */
  @Transactional
  public HomeView saveThemePolicy(ThemePolicyDraft input) {
    access.require("portal:update");
    access.require("portal:view");
    var home = homes.lockConfiguration().orElseThrow();
    UserService.version(home, input.version());
    home.setAllowThemeToggle(input.allowThemeToggle());
    home.setNightPrimaryColor(input.nightPrimaryColor().toLowerCase(java.util.Locale.ROOT));
    homes.saveAndFlush(home);
    return home(true);
  }
}
