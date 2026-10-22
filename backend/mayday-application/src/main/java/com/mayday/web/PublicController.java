package com.mayday.web;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.mayday.common.persistence.PageResult;
import com.mayday.common.web.ApiResponse;
import com.mayday.content.Notice;
import com.mayday.content.mapper.ContentRevisionMapper;
import com.mayday.content.mapper.NoticeMapper;
import com.mayday.content.mapper.PortalChannelMapper;
import com.mayday.service.ContentAssets;
import com.mayday.service.ContentService;
import com.mayday.service.SettingService;
import com.mayday.system.mapper.EntryMapper;
import com.mayday.system.model.SystemEntry;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 公开 DTO 只读取当前上线修订，编辑新稿、历史修订、内部内容、作者与部门 ID 均不进入匿名响应。 */
@RestController
@RequestMapping("/api/public")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PublicController
{
    private final NoticeMapper notices;
    private final PortalChannelMapper channels;
    private final ContentRevisionMapper revisions;
    private final EntryMapper entries;
    private final SettingService settingService;
    private final com.mayday.service.PortalStructureService portal;
    private final ContentAssets assets;

    /** 匿名门户只读取公开站点键、前台专用主题与启用分类，不公开后台主题或内部配置。 */
    @GetMapping("/site")
    public ApiResponse<?> site()
    {
        var settings = settingService.publicValues();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", settings.get("site.name"));
        result.put("description", settings.get("site.description"));
        result.put("seoTitle", settings.get("site.title"));
        result.put("keywords", settings.get("site.keywords"));
        result.put("contact", settings.get("site.contact"));
        result.put("phone", settings.get("site.phone"));
        result.put("address", settings.get("site.address"));
        result.put("copyright", settings.get("site.copyright"));
        result.put("icp", settings.get("site.icp"));
        result.put("theme", settingService.publicTheme());
        result.put("channels", portal.publicChannels());
        var home = portal.home(false);
        result.put("allowThemeToggle", home.allowThemeToggle());
        result.put("nightPrimaryColor", home.nightPrimaryColor());
        result.put("categories", entries.findByKindOrderBySortOrderAscIdAsc("categories").stream()
                .filter(SystemEntry::isEnabled).map(SystemEntry::getName).toList());
        return ApiResponse.ok(result);
    }

    /** 匿名分类和标签仅输出启用项的 ID/名称，不暴露管理字段或使用此接口写入。 */
    @GetMapping("/taxonomy")
    public ApiResponse<?> taxonomy()
    {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String kind : List.of("categories", "tags"))
        {
            result.put(kind, entries.findByKindOrderBySortOrderAscIdAsc(kind).stream().filter(SystemEntry::isEnabled)
                    .map(entry -> Map.of("id", entry.getId(), "name", entry.getName())).toList());
        }
        return ApiResponse.ok(result);
    }

    private Map<String, Object> article(Notice notice, boolean detail)
    {
        var revision = revisions.findById(notice.getLiveRevisionId()).orElseThrow();
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", notice.getId());
        view.put("title", revision.getTitle());
        view.put("summary", revision.getSummary());
        view.put("content", detail ? revision.getContent() : null);
        view.put("categoryId", revision.getCategoryId());
        view.put("portalChannelId", revision.getPortalChannelId());
        var channel = channels.findById(revision.getPortalChannelId()).orElse(null);
        view.put("channelCode", channel == null ? "" : channel.getCode());
        view.put("channelName", channel == null ? "" : channel.getName());
        view.put("channelTemplate", channel == null ? "" : channel.getTemplate());
        view.put("category", entries.findById(revision.getCategoryId()).map(SystemEntry::getName).orElse(""));
        view.put("tags", entries.findAllById(revision.getTagIds()).stream()
                .map(entry -> Map.of("id", entry.getId(), "name", entry.getName())).toList());
        view.put("authorName", notice.getAuthorName());
        view.put("createdAt", notice.getPublishedAt());
        view.put("viewCount", notice.getViewCount());
        view.put("pinned", revision.isPinned());
        view.put("recommended", revision.isRecommended());
        view.put("coverUrl",
                revision.getCoverId() == null ? null : "/api/public/articles/" + notice.getId() + "/cover");
        view.put("seoTitle", revision.getSeoTitle());
        view.put("seoKeywords", revision.getSeoKeywords());
        view.put("seoDescription", revision.getSeoDescription());
        if (detail)
        {
            view.put("attachments",
                    assets.records(revision.getAttachmentIds()).stream()
                            .map(file -> Map.of("id", file.getId(), "name", file.getName(), "size", file.getSize(),
                                    "url", "/api/public/articles/" + notice.getId() + "/files/" + file.getId()))
                            .toList());
        }
        return view;
    }

    private Map<String, Object> visibleArticle(Long id)
    {
        if (id == null)
        {
            return null;
        }
        return java.util.Optional
                .ofNullable(notices.selectOneByQuery(QueryWrapper.create()
                        .where(ContentService.publiclyVisible().and(new QueryColumn("id").eq(id)))))
                .map(n -> article(n, false)).orElse(null);
    }

    /** 按排序过的主键恢复实体顺序；复杂栏目排序留在 SQL 查询而不是交给不支持子查询的排序白名单。 */
    private List<Notice> publicNotices(List<Long> orderedIds)
    {
        if (orderedIds.isEmpty())
        {
            return List.of();
        }
        Map<Long, Notice> byId = notices.selectListByIds(orderedIds).stream()
                .collect(java.util.stream.Collectors.toMap(Notice::getId, notice -> notice));
        return orderedIds.stream().map(byId::get).filter(java.util.Objects::nonNull).toList();
    }

    /** 自动主视觉和公告分别按模板查询，避免其他栏目的大量新内容挤出首页必要入口。 */
    private Map<String, Object> automaticArticle(String template)
    {
        List<Long> ids = notices.publicArticleIds("", "", null, null, null, null, template, true, 1, 0);
        return publicNotices(ids).stream().findFirst().map(n -> article(n, false)).orElse(null);
    }

    /** 首页编排只投影当前公开版本；下线、停用、内部内容不会连同配置 ID 泄露，手动精选保持顺序。 */
    @GetMapping("/home")
    public ResponseEntity<?> home()
    {
        var config = portal.home(false);
        var recent = publicNotices(notices.publicArticleIds("", "", null, null, null, null, null, true, 12, 0)).stream()
                .map(n -> article(n, false)).toList();
        Map<String, Object> result = new LinkedHashMap<>();
        var automaticHero = config.heroArticleId() == null ? automaticArticle("GUIDE") : null;
        result.put("hero",
                config.heroArticleId() == null
                        ? (automaticHero != null ? automaticHero : (recent.isEmpty() ? null : recent.getFirst()))
                        : visibleArticle(config.heroArticleId()));
        result.put("notice",
                config.noticeArticleId() == null
                        ? automaticArticle("NOTICE")
                        : visibleArticle(config.noticeArticleId()));
        result.put("featured",
                config.featuredArticleIds().isEmpty()
                        ? recent.stream().limit(3).toList()
                        : config.featuredArticleIds().stream().map(this::visibleArticle)
                                .filter(java.util.Objects::nonNull).toList());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(ApiResponse.ok(result));
    }

    /** 将公开可见状态、栏目分类过滤和稳定排序放入分页 SQL，响应禁止缓存已下线内容。 */
    @GetMapping("/articles")
    public ResponseEntity<?> list(@RequestParam(defaultValue = "") String keyword,
            @RequestParam(defaultValue = "") String category, @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) String channel, @RequestParam(required = false) Long tagId,
            @RequestParam(required = false) Boolean recommended, @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "9") int size)
    {
        Long channelId = channel == null ? null : portal.publicChannel(channel).getId();
        int normalizedPage = Math.max(1, page);
        int normalizedSize = Math.max(1, Math.min(100, size));
        long offset = (long) (normalizedPage - 1) * normalizedSize;
        long total = notices.countPublicArticles(keyword, category, categoryId, channelId, tagId, recommended);
        List<Long> ids = notices.publicArticleIds(keyword, category, categoryId, channelId, tagId, recommended, null,
                false, normalizedSize, offset);
        List<Map<String, Object>> items = publicNotices(ids).stream().map(notice -> article(notice, false)).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ApiResponse.ok(new PageResult<>(items, total, normalizedPage, normalizedSize)));
    }

    /** 只返回当前公开上线修订；不存在、内部或未发布的内容统一返回 404，避免探测草稿。 */
    @GetMapping("/articles/{id}")
    public ResponseEntity<?> detail(@PathVariable Long id)
    {
        var found = java.util.Optional.ofNullable(notices.selectOneByQuery(QueryWrapper.create()
                .where(ContentService.publiclyVisible().and(new com.mybatisflex.core.query.QueryColumn("id").eq(id)))));
        if (found.isEmpty())
        {
            return ResponseEntity.status(404).cacheControl(CacheControl.noStore())
                    .body(ApiResponse.error("内容不存在或尚未发布"));
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ApiResponse.ok(article(found.get(), true)));
    }

    /** 浏览次数为成功的详情进入上报次数，刷新计入，后台轮询不计入；客户端不能直接设置统计数字。 */
    @PostMapping("/articles/{id}/view")
    @Transactional
    public ResponseEntity<?> recordView(@PathVariable Long id)
    {
        var found = java.util.Optional.ofNullable(notices.selectOneByQuery(QueryWrapper.create()
                .where(ContentService.publiclyVisible().and(new com.mybatisflex.core.query.QueryColumn("id").eq(id)))));
        if (found.isEmpty())
        {
            return ResponseEntity.status(404).cacheControl(CacheControl.noStore())
                    .body(ApiResponse.error("内容不存在或尚未发布"));
        }
        notices.incrementViews(id);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(ApiResponse.ok(found.get().getViewCount() + 1));
    }
}
