import { useQuery } from "@tanstack/react-query";
import { Empty } from "antd";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SiteFrame, PortalState } from "../components/Portal";
import {
  PortalHero,
  PortalNoticeStrip,
  PortalChannelEntries,
  PortalArticleCard,
} from "../components/PortalViews";
import { api } from "../lib/api";
import { useSite, useSeo } from "../lib/portal";
import type { Article } from "../types";

interface PortalHome {
  hero: Article | null;
  notice: Article | null;
  featured: Article[];
}

/** 首页使用服务端独立编排结果；选中文章下线后自动隐藏，不重新发布或展示旧缓存正文。 */
export function PortalHomePage() {
  const site = useSite();
  const home = useQuery({
    queryKey: ["public", "home"],
    queryFn: ({ signal }) => api<PortalHome>("/public/home", { signal }),
    refetchInterval: 30000,
  });
  useSeo(
    site.data?.seoTitle || `${site.data?.name || "Mayday"} · 客户服务`,
    site.data?.description ?? "",
    site.data?.keywords ?? "",
  );
  return (
    <SiteFrame>
      <main id="site-main" tabIndex={-1} className="site-container portal-home">
        <PortalState
          loading={home.isLoading || site.isLoading}
          error={home.error ?? site.error}
          retry={() => {
            void home.refetch();
            void site.refetch();
          }}
        >
          <PortalHero article={home.data?.hero} />
          <PortalNoticeStrip article={home.data?.notice} />
          <PortalChannelEntries channels={site.data?.channels ?? []} />
          <section
            className="portal-featured"
            aria-labelledby="portal-featured-title"
          >
            <div className="portal-section-heading">
              <h2 id="portal-featured-title">精选内容</h2>
              <Link to="/?q=">
                查看更多 <ArrowRight size={15} />
              </Link>
            </div>
            {home.data?.featured.length ? (
              <div className="portal-card-grid">
                {home.data.featured.map((article) => (
                  <PortalArticleCard
                    key={article.id}
                    article={article}
                    showCategory={false}
                  />
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂时没有已发布内容"
              />
            )}
          </section>
        </PortalState>
      </main>
    </SiteFrame>
  );
}
