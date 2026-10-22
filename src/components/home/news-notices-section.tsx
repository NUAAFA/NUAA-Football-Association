import Image from "@/components/ui/site-image";
import Link from "next/link";
import { demoNews, demoNotices } from "@/data/content";
import { DemoLabel } from "@/components/ui/demo-label";
import { SectionHeading } from "@/components/ui/section-heading";

function NewsList() {
  return (
    <div className="news-block">
      <div className="content-block-head"><div><small>LATEST STORIES</small><h3>最新新闻</h3></div><Link href="/news">查看全部 <span aria-hidden="true">→</span></Link></div>
      <div className="news-v2-grid">
        {demoNews.map((item, index) => (
          <article className={index === 0 ? "news-v2-card news-v2-featured" : "news-v2-card"} key={item.id}>
            <div className="news-v2-image">
              <Image src={item.image} alt={item.imageAlt} fill sizes={index === 0 ? "(max-width: 760px) 100vw, 48vw" : "(max-width: 760px) 100vw, 24vw"} />
              <span>{item.category}</span><DemoLabel>演示内容</DemoLabel>
            </div>
            <div className="news-v2-body"><time>{item.dateLabel}</time><h4>{item.title}</h4><p>{item.summary}</p><Link href="/news" aria-label={`查看演示新闻：${item.title}`}>查看内容 <span aria-hidden="true">↗</span></Link></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function NoticeList() {
  return (
    <aside className="notices-block" aria-labelledby="notices-title">
      <div className="content-block-head"><div><small>OFFICIAL NOTICES</small><h3 id="notices-title">通知公告</h3></div><DemoLabel>演示内容</DemoLabel></div>
      <div className="notice-list">
        {demoNotices.map((item) => {
          return (
            <article className="notice-item" key={item.id}>
              <time><strong>—</strong><span>{item.dateLabel}</span></time>
              <div><span>{item.category}</span><h4>{item.title}</h4><Link href="/news" aria-label={`查看演示公告：${item.title}`}>详情 <b aria-hidden="true">→</b></Link></div>
            </article>
          );
        })}
      </div>
      <p className="notice-disclaimer">公告日期和标题均为界面演示，不构成真实报名或赛程通知。</p>
    </aside>
  );
}

export function NewsNoticesSection() {
  return (
    <section className="section news-notices-section" id="news" aria-labelledby="news-notices-title">
      <div className="page-shell">
        <SectionHeading eyebrow="INFORMATION CHANNEL / 信息通道" title="新闻与公告，清晰分流" description="新闻记录赛场与协会故事，公告承载报名、规程与赛程等正式信息。当前内容均为演示。" id="news-notices-title" />
        <div className="news-notices-layout"><NewsList /><NoticeList /></div>
      </div>
    </section>
  );
}
