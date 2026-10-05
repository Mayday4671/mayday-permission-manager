package com.mayday.crawler;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.common.FileUsage;
import com.mayday.operations.OperationSupport;
import com.mayday.operations.model.FilePayload;
import com.mayday.operations.model.StoredFile;
import com.mayday.operations.repository.FilePayloadRepository;
import com.mayday.operations.repository.StoredFileRepository;
import com.mayday.security.AccessPolicy;
import com.mayday.system.repository.UserRepository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 所有队列变更串行锁定任务行；网络请求在事务外执行。租约令牌阻止停止/超时后旧工作器提交结果。 执行人每次领取及保存时重新核对当前授权，账号停用/撤权立即阻止后续采集和入库。 */
@Service
@RequiredArgsConstructor
@Transactional
public class CrawlStore implements FileUsage {
  private final CrawlTaskRepository tasks;
  private final CrawlItemRepository items;
  private final AccessPolicy access;
  private final UserRepository users;
  private final StoredFileRepository files;
  private final FilePayloadRepository payloads;
  private final CrawlArticles articles;
  private final org.springframework.jdbc.core.JdbcTemplate jdbc;

  /** 所有节点使用数据库时间处理租约，应用服务器时钟偏差不改变所有权。 */
  private LocalDateTime databaseNow() {
    return jdbc.queryForObject("select current_timestamp(6)", LocalDateTime.class);
  }

  private static final Set<String> ACTIVE = Set.of("QUEUED", "RUNNING");

  /** 不可变领取快照，网络工作器只能用原租约提交；配置、页组和序号不会由网页响应覆盖。 */
  public record Work(
      Long taskId,
      Long itemId,
      String lease,
      String url,
      String kind,
      String root,
      int ordinal,
      CrawlRules rules) {}

  /** 配置和数据共用任务所有者边界；需要改变状态时获取主任务行锁。 */
  public CrawlTask accessible(Long id, boolean locked) {
    access.require("crawler:view");
    var task =
        (locked ? tasks.lock(id) : tasks.findById(id))
            .orElseThrow(() -> new BusinessException("采集任务不存在"));
    if (!access.has("crawler:all") && !Objects.equals(task.getOwnerId(), access.current().getId()))
      throw new AccessDeniedException("无权访问此采集任务");
    return task;
  }

  /** 配置接口拒绝已删除的配置；数据读取仍经 accessible 校验原所有者，不能因删除而放宽访问。 */
  public CrawlTask configuration(Long id, boolean locked) {
    var task = accessible(id, locked);
    if (task.isArchived()) throw new BusinessException("采集配置已删除");
    return task;
  }

  /** 规则只能编辑未运行草稿；新配置以账号行锁保护未结束任务的数量限制。 */
  public CrawlTask save(Long id, String name, CrawlRules rules, Long version) {
    access.require("crawler:view");
    access.require(id == null ? "crawler:create" : "crawler:update");
    rules.validate();
    var task = id == null ? new CrawlTask() : configuration(id, true);
    if (id != null) {
      OperationSupport.version(task, version);
      if (!task.getStatus().equals("DRAFT")) throw new BusinessException("已开始的任务不能修改规则，请复制为新任务");
    } else {
      users.lockById(access.current().getId()).orElseThrow(() -> new BusinessException("账号不存在"));
      if (tasks.countByOwnerIdAndStatusInAndArchivedFalse(
              access.current().getId(), Set.of("DRAFT", "QUEUED", "RUNNING", "PAUSED"))
          >= 30) throw new BusinessException("未结束任务已达 30 个，请先清理或完成已有任务");
      task.setOwnerId(access.current().getId());
      task.setOwnerName(access.current().getNickname());
    }
    task.setName(name.trim());
    task.setRulesJson(rules.json());
    return tasks.saveAndFlush(task);
  }

  /** 校验当前版本与执行/文件权限，初次入队、续跑和失败项重试分别处理，不重复创建成功结果。 */
  public CrawlTask start(Long id, Long version, boolean retry) {
    access.require("crawler:run");
    access.require("files:create");
    var task = configuration(id, true);
    OperationSupport.version(task, version);
    if (ACTIVE.contains(task.getStatus())) throw new BusinessException("任务已在执行中");
    if (task.getStatus().equals("LIMITED")) throw new BusinessException("已达到容量上限，请调整规则后复制新任务");
    users
        .lockById(task.getOwnerId())
        .orElseThrow(() -> new BusinessException("任务创建账号已删除，请复制到当前账号"));
    if (tasks.countByOwnerIdAndStatusInAndArchivedFalse(task.getOwnerId(), ACTIVE) >= 3)
      throw new BusinessException("每个账号最多同时运行 3 个任务");
    if (retry) {
      var failed = items.findByTaskIdAndStatus(id, "FAILED");
      if (failed.isEmpty()) throw new BusinessException("没有需要重试的失败记录");
      failed.forEach(
          i -> {
            i.setStatus("QUEUED");
            i.setAttempts(0);
            i.setError(null);
          });
      task.setFailedCount(0);
    } else if (task.getStatus().equals("DRAFT")) {
      enqueue(task, "LIST", task.getRules().entryUrl(), task.getRules().entryUrl(), null, 0);
    } else if (!task.getStatus().equals("PAUSED"))
      throw new BusinessException("已结束任务请使用重试失败项或复制任务");
    task.setRunnerId(access.current().getId());
    task.setStatus("QUEUED");
    task.setLastError(null);
    task.setNextFetchAt(BusinessTime.now());
    task.setLeaseToken(null);
    task.setLeaseUntil(null);
    return tasks.saveAndFlush(task);
  }

  /** 停止立即撤销租约并将正在请求的条目回到队列，已经在网络中的旧结果不再允许提交。 */
  public CrawlTask stop(Long id, Long version) {
    access.require("crawler:stop");
    var task = configuration(id, true);
    OperationSupport.version(task, version);
    if (!ACTIVE.contains(task.getStatus())) throw new BusinessException("任务当前没有运行");
    pause(task, null);
    return tasks.saveAndFlush(task);
  }

  private void pause(CrawlTask task, String reason) {
    task.setStatus("PAUSED");
    task.setLeaseToken(null);
    task.setLeaseUntil(null);
    task.setLastError(reason);
    items.findByTaskIdAndStatus(task.getId(), "FETCHING").forEach(item -> item.setStatus("QUEUED"));
  }

  /** 配置删除不级联销毁已有文章；有数据时只归档并停止剩余队列，没有数据才物理清理。 */
  public void delete(Long id) {
    access.require("crawler:delete");
    var task = configuration(id, true);
    if (ACTIVE.contains(task.getStatus())) throw new BusinessException("请先停止采集再删除任务");
    // 配置与数据有独立生命周期：已有文章时保留来源、正文及图片引用，不级联删除数据。
    // 空配置仍可物理清理，避免测试或未执行的草稿留下无用的归档记录。
    if (articles.hasData(id)) {
      // 已删除配置不会再执行；未处理队列标为跳过，避免数据页一直显示“等待采集”。
      for (String state : List.of("QUEUED", "FETCHING")) {
        items
            .findByTaskIdAndStatus(id, state)
            .forEach(
                item -> {
                  item.setStatus("SKIPPED");
                  item.setError("配置已删除，未继续采集");
                });
      }
      task.setArchived(true);
      task.setLeaseToken(null);
      task.setLeaseUntil(null);
      task.setNextFetchAt(null);
      tasks.saveAndFlush(task);
    } else {
      items.deleteByTaskId(id);
      items.flush();
      tasks.delete(task);
    }
  }

  private boolean authorized(CrawlTask task) {
    return !task.isArchived()
        && task.getRunnerId() != null
        && users
            .findById(task.getRunnerId())
            .filter(
                user ->
                    access.hasFor(user, "crawler:view")
                        && access.hasFor(user, "crawler:run")
                        && access.hasFor(user, "files:create")
                        && (Objects.equals(user.getId(), task.getOwnerId())
                            || access.hasFor(user, "crawler:all")))
            .isPresent();
  }

  /** 从到期任务领取一条队列并生成 120 秒租约；数据库内串行领取，网络处理在提交后执行。 */
  public Work claim() {
    var now = databaseNow();
    for (Long id : tasks.ready(now, PageRequest.of(0, 10))) {
      var task = tasks.lock(id).orElseThrow();
      if (!ACTIVE.contains(task.getStatus())
          || task.getLeaseUntil() != null && task.getLeaseUntil().isAfter(now)
          || task.getNextFetchAt() != null && task.getNextFetchAt().isAfter(now)) continue;
      if (!authorized(task)) {
        pause(task, "执行账号已停用、删除或权限已撤回");
        continue;
      }
      items
          .findByTaskIdAndStatus(id, "FETCHING")
          .forEach(
              i -> {
                if (i.getAttempts() >= 3) {
                  i.setStatus("FAILED");
                  i.setError("连续故障恢复已达重试上限，可明确重试");
                  task.setFailedCount(task.getFailedCount() + 1);
                } else i.setStatus("QUEUED");
              });
      items.flush();
      var item = items.findFirstByTaskIdAndStatusOrderByIdAsc(id, "QUEUED").orElse(null);
      if (item == null) {
        task.setStatus(task.getFailedCount() > 0 ? "PARTIAL" : "COMPLETED");
        task.setLeaseToken(null);
        task.setLeaseUntil(null);
        continue;
      }
      String lease = UUID.randomUUID().toString();
      task.setLeaseToken(lease);
      task.setLeaseUntil(now.plusSeconds(120));
      task.setStatus("RUNNING");
      item.setStatus("FETCHING");
      item.setAttempts(item.getAttempts() + 1);
      return new Work(
          id,
          item.getId(),
          lease,
          item.getUrl(),
          item.getKind(),
          item.getRootUrl(),
          item.getOrdinal(),
          task.getRules());
    }
    return null;
  }

  /** 仅原工作器在未过期期间续期；停止、撤权和到期后旧令牌不能复活。 */
  public boolean heartbeat(Work work) {
    var task = tasks.lock(work.taskId()).orElse(null);
    var now = databaseNow();
    if (task == null
        || !ACTIVE.contains(task.getStatus())
        || !Objects.equals(task.getLeaseToken(), work.lease())
        || task.getLeaseUntil() == null
        || !task.getLeaseUntil().isAfter(now)
        || !authorized(task)) return false;
    task.setLeaseUntil(now.plusSeconds(120));
    return true;
  }

  /** 提交前重新验证租约与执行人权限，状态、正文、图片和新链接在同一事务保存。 失败最多重试 3 次并采用等待间隔；重复图片复用文件，容量达到上限后不继续扩张队列。 */
  public void finish(Work work, PageExtractor.Links links, byte[] image, String failure) {
    var task = tasks.lock(work.taskId()).orElse(null);
    if (task == null
        || !ACTIVE.contains(task.getStatus())
        || !Objects.equals(task.getLeaseToken(), work.lease())
        || task.getLeaseUntil() == null
        || !task.getLeaseUntil().isAfter(databaseNow())) return;
    if (!authorized(task)) {
      pause(task, "执行账号已停用、删除或权限已撤回");
      return;
    }
    var item = items.findById(work.itemId()).orElseThrow();
    task.setLeaseToken(null);
    task.setLeaseUntil(null);
    task.setNextFetchAt(BusinessTime.now().plusNanos((long) work.rules().intervalMs() * 1000000));
    if (failure != null) {
      item.setError(failure);
      task.setLastError(failure);
      item.setStatus(item.getAttempts() < 3 ? "QUEUED" : "FAILED");
      if (item.getStatus().equals("FAILED")) task.setFailedCount(task.getFailedCount() + 1);
      task.setNextFetchAt(BusinessTime.now().plusSeconds(Math.min(30, item.getAttempts() * 5L)));
      return;
    }
    item.setError(null);
    item.setStatus("SUCCESS");
    if (image != null) {
      String digest = ImageBytes.hash(image);
      var duplicate =
          items.findFirstByTaskIdAndDigestAndStatus(task.getId(), digest, "SUCCESS").orElse(null);
      item.setDigest(digest);
      if (duplicate != null) {
        item.setStatus("DUPLICATE");
        item.setFileId(duplicate.getFileId());
        item.setBytes(duplicate.getBytes());
        return;
      }
      if (task.getImageCount() >= work.rules().maxImages()
          || task.getTotalBytes() + image.length > 200L * 1024 * 1024) {
        task.setStatus("LIMITED");
        task.setLastError("已达到图片数量或 200 MB 容量上限");
        item.setStatus("SKIPPED");
        return;
      }
      String ext = ImageBytes.type(image);
      var file = new StoredFile();
      file.setName(
          "采集-" + task.getId() + "-" + item.getId() + "." + (ext.equals("jpeg") ? "jpg" : ext));
      file.setContentType("image/" + ext);
      file.setOwnerId(task.getOwnerId());
      file.setOwnerName(task.getOwnerName());
      file.setSize(image.length);
      files.saveAndFlush(file);
      var payload = new FilePayload();
      payload.setId(file.getId());
      payload.setData(image);
      payloads.save(payload);
      item.setFileId(file.getId());
      item.setBytes(image.length);
      task.setImageCount(task.getImageCount() + 1);
      task.setTotalBytes(task.getTotalBytes() + image.length);
    } else {
      task.setPageCount(task.getPageCount() + 1);
      item.setTitle(links.title());
      var article = articles.savePage(work, item, links);
      int position = 0;
      for (String url : links.images()) {
        var imageItem = enqueue(task, "IMAGE", url, work.root(), work.url(), 0);
        articles.link(article, imageItem, work.ordinal() * 1000 + position++);
      }
      for (String url : links.details()) enqueue(task, "DETAIL", url, url, work.url(), 0);
      for (String url : links.pages())
        enqueue(task, work.kind(), url, work.root(), work.url(), work.ordinal() + 1);
    }
  }

  private CrawlItem enqueue(
      CrawlTask task, String kind, String url, String root, String source, int ordinal) {
    url = WebAddress.allowed(url, task.getRules(), kind.equals("IMAGE")).toString();
    String hash = ImageBytes.hash(url);
    var existing = items.findByTaskIdAndKindAndUrlHash(task.getId(), kind, hash);
    if (existing.isPresent()) return existing.get();
    if (items.countByTaskId(task.getId()) >= 5000) {
      task.setStatus("LIMITED");
      task.setLastError("已达到 5000 条采集队列上限");
      return null;
    }
    if (kind.equals("IMAGE")
        && items.countByTaskIdAndKind(task.getId(), kind) >= task.getRules().maxImages())
      return null;
    if (kind.equals("DETAIL")
        && ordinal == 0
        && items.count(
                (r, q, c) ->
                    c.and(
                        c.equal(r.get("taskId"), task.getId()),
                        c.equal(r.get("kind"), "DETAIL"),
                        c.equal(r.get("ordinal"), 0)))
            >= task.getRules().maxDetails()) return null;
    if (!kind.equals("IMAGE")
        && items.countByTaskIdAndKindAndRootUrl(task.getId(), kind, root)
            >= (kind.equals("LIST") ? task.getRules().list() : task.getRules().detail()).maxPages())
      return null;
    var item = new CrawlItem();
    item.setTaskId(task.getId());
    item.setKind(kind);
    item.setUrl(url);
    item.setUrlHash(hash);
    item.setRootUrl(root);
    item.setSourceUrl(source);
    item.setOrdinal(ordinal);
    items.saveAndFlush(item);
    return item;
  }

  @Override
  @Transactional(readOnly = true)
  public boolean referenced(Long fileId) {
    return items.existsByFileId(fileId);
  }
}
