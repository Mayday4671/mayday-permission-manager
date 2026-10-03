package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.common.PageResult;
import com.mayday.common.SearchPredicates;
import com.mayday.content.ContentPublicationRepository;
import com.mayday.content.ContentRevision;
import com.mayday.content.Notice;
import com.mayday.content.NoticeRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.service.ContentService;
import com.mayday.web.ContentContracts.Draft;
import com.mayday.web.ContentContracts.Publish;
import com.mayday.web.ContentContracts.Version;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 列表、详情、修订和回收站使用相同内容范围；业务状态与版本规则集中在 ContentService。 */
@RestController
@RequestMapping("/api/content/notices")
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class NoticeController {
  private final NoticeRepository notices;
  private final ContentPublicationRepository publications;
  private final ContentService service;
  private final AccessPolicy access;
  private final com.mayday.service.PortalStructureService portal;

  /** 内容编辑所用的栏目与分类选项只要求内容查看权，不能用于修改门户配置。 */
  @GetMapping("/portal-options")
  public ApiResponse<java.util.List<com.mayday.service.PortalStructureService.ChannelView>>
      portalOptions() {
    return ApiResponse.ok(portal.options());
  }

  /** 内容范围进入分页 SQL；普通管理筛选草稿，公开内容选择器按线上修订搜索、过滤栏目与模板。 */
  @GetMapping
  public ApiResponse<?> list(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(required = false) Boolean published,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Long categoryId,
      @RequestParam(required = false) Long portalChannelId,
      @RequestParam(required = false) String portalTemplate,
      @RequestParam(required = false) Boolean publiclyVisible,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("notices:view");
    var spec =
        access
            .<Notice>filter("notices", "authorId")
            .and(
                (root, query, criteria) ->
                    criteria.and(
                        criteria.isNull(root.get("deletedAt")),
                        SearchPredicates.contains(
                            criteria,
                            Boolean.TRUE.equals(publiclyVisible)
                                ? root.get("liveRevision").get("title")
                                : root.get("title"),
                            keyword),
                        published == null
                            ? criteria.conjunction()
                            : criteria.equal(root.get("published"), published),
                        status == null || status.isBlank()
                            ? criteria.conjunction()
                            : criteria.equal(root.get("draftStatus"), status)));
    if (Boolean.TRUE.equals(publiclyVisible)) spec = spec.and(ContentService.publiclyVisible());
    if (categoryId != null || portalChannelId != null || portalTemplate != null)
      spec =
          spec.and(
              (root, query, criteria) -> {
                var categoryQuery = query.subquery(Long.class);
                var revision = categoryQuery.from(ContentRevision.class);
                categoryQuery
                    .select(revision.get("id"))
                    .where(
                        criteria.and(
                            categoryId == null
                                ? criteria.conjunction()
                                : criteria.equal(revision.get("categoryId"), categoryId),
                            portalChannelId == null
                                ? criteria.conjunction()
                                : criteria.equal(revision.get("portalChannelId"), portalChannelId),
                            portalTemplate == null
                                ? criteria.conjunction()
                                : criteria.equal(
                                    revision.get("portalChannel").get("template"),
                                    portalTemplate)));
                return root.get(
                        Boolean.TRUE.equals(publiclyVisible) ? "liveRevisionId" : "draftRevisionId")
                    .in(categoryQuery);
              });
    return ApiResponse.ok(
        PageResult.from(notices.findAll(spec, PageResult.request(page, size)).map(service::view)));
  }

  /** 读取当前有权管理的非回收内容，服务层检查查看权限与记录所属范围。 */
  @GetMapping("/{id}")
  public ApiResponse<?> detail(@PathVariable Long id) {
    return ApiResponse.ok(service.view(service.managed(id, false)));
  }

  /** 修订历史继承主内容的查看边界，不能借修订 ID 读取他人或范围外草稿。 */
  @GetMapping("/{id}/revisions")
  public ApiResponse<?> revisions(@PathVariable Long id) {
    return ApiResponse.ok(service.history(id));
  }

  /** 先验证主内容访问权，再分页读取该内容的发布记录，不直接放开记录表查询。 */
  @GetMapping("/{id}/publications")
  public ApiResponse<?> publications(
      @PathVariable Long id,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    service.managed(id, false);
    return ApiResponse.ok(
        PageResult.from(
            publications.findAll(
                (root, query, criteria) -> criteria.equal(root.get("noticeId"), id),
                PageResult.request(page, size))));
  }

  /** 创建草稿修订，作者和部门来自当前身份，文件引用与正文清洗由服务层统一处理。 */
  @PostMapping
  @Transactional
  public ApiResponse<?> create(@Valid @RequestBody Draft request) {
    return ApiResponse.ok(service.save(null, request));
  }

  /** 保存新草稿并验证当前版本；已上线内容继续展示原上线修订，保存不暗中替换公开正文。 */
  @PutMapping("/{id}")
  @Transactional
  public ApiResponse<?> update(@PathVariable Long id, @Valid @RequestBody Draft request) {
    return ApiResponse.ok(service.save(id, request));
  }

  /** 独立发布动作检查发布权限、修订版本、审批状态及定时窗口，事务内更新上线指针。 */
  @PostMapping("/{id}/publish")
  @Transactional
  public ApiResponse<?> publish(@PathVariable Long id, @Valid @RequestBody Publish request) {
    return ApiResponse.ok(service.publish(id, request));
  }

  /** 下线前验证发布权限和当前版本，停止前台展示同时保留修订与发布历史。 */
  @PostMapping("/{id}/offline")
  @Transactional
  public ApiResponse<?> offline(@PathVariable Long id, @Valid @RequestBody Version request) {
    return ApiResponse.ok(service.offline(id, request.version()));
  }

  /** 在删除权限与内容范围内移入回收站；公开可见性同时关闭，保留恢复所需历史。 */
  @DeleteMapping("/{id}")
  @Transactional
  public ApiResponse<?> delete(@PathVariable Long id) {
    service.delete(id);
    return ApiResponse.ok(null);
  }

  /** 回收站查询仍受同一内容数据范围约束，只返回已回收记录。 */
  @GetMapping("/recycle")
  public ApiResponse<?> recycle(
      @RequestParam(defaultValue = "") String keyword,
      @RequestParam(defaultValue = "1") int page,
      @RequestParam(defaultValue = "10") int size) {
    access.require("notices:view");
    return ApiResponse.ok(
        PageResult.from(
            notices
                .findAll(
                    access
                        .<Notice>filter("notices", "authorId")
                        .and(
                            (root, query, criteria) ->
                                criteria.and(
                                    criteria.isNotNull(root.get("deletedAt")),
                                    SearchPredicates.contains(
                                        criteria, root.get("title"), keyword))),
                    PageResult.request(page, size))
                .map(service::view)));
  }

  /** 恢复回收记录需单独恢复权限与原 version，不因恢复而自动重新发布。 */
  @PostMapping("/{id}/restore")
  @Transactional
  public ApiResponse<?> restore(@PathVariable Long id, @Valid @RequestBody Version request) {
    return ApiResponse.ok(service.restore(id, request.version()));
  }

  /** 彻底清理只接受回收站内有权处理的内容，服务层保护关联审批和仍被使用的资源。 */
  @DeleteMapping("/{id}/purge")
  @Transactional
  public ApiResponse<?> purge(@PathVariable Long id) {
    service.purge(id);
    return ApiResponse.ok(null);
  }
}
