package com.mayday.crawler;

import com.mayday.common.*;
import com.mayday.security.AccessPolicy;
import java.time.LocalDateTime;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 文章归档与读取共用任务的授权边界。写入由 CrawlStore 在任务锁内调用，文章和图片关联与队列一并提交。
 * 卡片只返回摘要；正文分页按 ordinal/id 排序，详情一次最多返回 100,000 字符并提示截断。
 */
@Service @RequiredArgsConstructor @Transactional
public class CrawlArticles {
  private final CrawlArticleRepository articles;
  private final CrawlArticleImageRepository links;
  private final CrawlItemRepository items;
  private final CrawlTaskRepository tasks;
  private final AccessPolicy access;
  public record Card(Long id,String title,String summary,String author,String publishedAt,String sourceUrl,
      LocalDateTime collectedAt,int pageCount,int imageCount,int pendingImages,int failedImages,Long coverItemId,
      Long taskId,String taskName,String taskStatus,int imageLimit) {}
  public record Part(Long id,String sourceUrl,String body,boolean truncated) {}
  public record Picture(Long id,Long fileId,long bytes) {}
  public record Detail(Card article,List<Part> pages,List<Picture> images,boolean truncated) {}

  public CrawlArticle savePage(CrawlStore.Work work,CrawlItem item,PageExtractor.Links parsed) {
    var text=parsed.article();if(text==null)return null;
    String hash=ImageBytes.hash(work.root());
    var article=articles.findByTaskIdAndSourceHash(work.taskId(),hash).orElseGet(()->{
      var created=new CrawlArticle();created.setTaskId(work.taskId());created.setSourceUrl(work.root());created.setSourceHash(hash);return created;
    });
    if(article.getId()==null || work.ordinal()==0) {
      article.setTitle(!text.title().isBlank()?text.title():!parsed.title().isBlank()?parsed.title():"未命名文章");
      article.setAuthor(text.author());article.setPublishedAt(text.publishedAt());
      article.setSummary(ArticleExtractor.limit(text.body().replaceAll("\\s+"," "),300));
    } else if(article.getSummary().isBlank()&&!text.body().isBlank()) {
      article.setSummary(ArticleExtractor.limit(text.body().replaceAll("\\s+"," "),300));
    }
    articles.saveAndFlush(article);
    item.setArticleId(article.getId());item.setArticleBody(text.body());item.setBodyTruncated(text.truncated());
    return article;
  }
  public void link(CrawlArticle article,CrawlItem image,int order) {
    if(article==null || image==null || links.existsByArticleIdAndItemId(article.getId(),image.getId()))return;
    var link=new CrawlArticleImage();link.setArticleId(article.getId());link.setItemId(image.getId());link.setSortOrder(order);links.save(link);
  }
  public void deleteLinks(Long task) { links.deleteForTask(task); }
  public boolean hasData(Long task) { return articles.existsByTaskId(task); }
  public void deleteArticles(Long task) { articles.deleteByTaskId(task);articles.flush(); }
  /** 下载失败或尚在队列的封面不返回地址；浏览器只请求已入库图片的鉴权接口。 */
  private List<CrawlItem> saved(List<CrawlItem> images) {
    var seen=new HashSet<Long>();
    return images.stream().filter(i->i.getFileId()!=null&&Set.of("SUCCESS","DUPLICATE").contains(i.getStatus())&&seen.add(i.getFileId())).toList();
  }
  private Card card(CrawlArticle a,List<CrawlItem> images,int pages,CrawlTask task) {
    var saved=saved(images);
    return new Card(a.getId(),a.getTitle(),a.getSummary(),a.getAuthor(),a.getPublishedAt(),a.getSourceUrl(),a.getCreatedAt(),pages,saved.size(),
      (int)images.stream().filter(i->Set.of("QUEUED","FETCHING").contains(i.getStatus())).count(),
      (int)images.stream().filter(i->Set.of("FAILED","SKIPPED").contains(i.getStatus())).count(),saved.isEmpty()?null:saved.getFirst().getId(),
      task.getId(),task.getName(),task.getStatus(),task.getRules().maxImages());
  }
  @Transactional(readOnly=true) public PageResult<Card> list(Long task,String keyword,int page,int size) {
    access.require("crawler:view");
    boolean all=access.has("crawler:all");Long owner=access.current().getId();
    // 跨任务卡片必须先在 SQL 内限制任务所有者，再统计总数和分页，不能取回所有文章后在前端过滤。
    var data=articles.findAll((r,q,c)->{
      var allowed=q.subquery(Long.class);var t=allowed.from(CrawlTask.class);
      allowed.select(t.get("id")).where(all?c.conjunction():c.equal(t.get("ownerId"),owner));
      return c.and(r.get("taskId").in(allowed),task==null?c.conjunction():c.equal(r.get("taskId"),task),SearchPredicates.contains(c,r.get("title"),keyword));
    },PageResult.request(page,Math.min(size,24)));
    var byId=new HashMap<Long,CrawlTask>();tasks.findAllById(data.stream().map(CrawlArticle::getTaskId).distinct().toList()).forEach(t->byId.put(t.getId(),t));
    return PageResult.from(data.map(a->card(a,links.images(a.getId()),(int)items.countByArticleId(a.getId()),byId.get(a.getTaskId()))));
  }
  @Transactional(readOnly=true) public Detail detail(Long task,Long id) {
    var a=articles.findById(id).filter(article->article.getTaskId().equals(task)).orElseThrow(()->new BusinessException("采集文章不存在"));
    var images=links.images(id);var pages=items.findByArticleIdOrderByOrdinalAscIdAsc(id);
    var parts=new ArrayList<Part>();int budget=100000;boolean truncated=false;
    for(var page:pages) {
      String body=CrawlRules.text(page.getArticleBody());String bounded=ArticleExtractor.limit(body,budget);
      boolean cut=page.isBodyTruncated() || body.length()>bounded.length();truncated|=cut;
      if(!bounded.isBlank()||parts.isEmpty())parts.add(new Part(page.getId(),page.getUrl(),bounded,cut));
      budget-=bounded.length();
    }
    return new Detail(card(a,images,pages.size(),tasks.findById(task).orElseThrow()),parts,saved(images).stream().map(i->new Picture(i.getId(),i.getFileId(),i.getBytes())).toList(),truncated);
  }
}
