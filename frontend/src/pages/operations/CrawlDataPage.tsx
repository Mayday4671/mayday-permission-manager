import { CrawlArticleCards } from "../../components/CrawlArticleCards";

/**
 * 采集数据独立入口：只读取当前账号有权查看的文章与配图，不挂载规则表单或任务列表。
 * 与配置页共享的只有结果失效通知；离开此路由后停止数据轮询，配置状态不影响浏览页状态。
 */
export function CrawlDataPage() {
  return (
    <section className="panel crawl-browser">
      <CrawlArticleCards active />
    </section>
  );
}
