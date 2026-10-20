import Image from "next/image";
import Link from "next/link";

import { ArchiveDocuments } from "@/components/competitions/archive/archive-documents";
import { ArchiveGallery } from "@/components/competitions/archive/archive-gallery";
import { mensCupGallery, mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";

export function CompetitionStories() {
  const { competition, news } = mensIntercollegeCup2026;

  return (
    <>
      <section className="cup-archive-section" id="reports" aria-labelledby="cup-stories-title">
        <div className="page-shell">
          <div className="cup-section-heading">
            <div><p>COMPETITION REPORTS</p><h2 id="cup-stories-title">赛事报道</h2></div>
            <span>5篇正式报道记录赛前、决赛与收官节点。</span>
          </div>
          <div className="cup-story-list">
            {news.map((story, index) => (
              <Link className={index === 0 ? "is-featured" : undefined} href={story.href} key={story.id}>
                <div><Image src={story.image} alt={story.imageAlt} fill sizes={index === 0 ? "(max-width: 760px) 100vw, 50vw" : "(max-width: 760px) 100vw, 260px"} /></div>
                <article><span>{story.category} · {story.dateLabel}</span><h3>{story.title}</h3><p>{story.summary}</p><b>阅读全文 →</b></article>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="cup-archive-section cup-archive-section-tint" id="media" aria-labelledby="cup-media-title">
        <div className="page-shell">
          <div className="cup-section-heading"><div><p>PHOTO ARCHIVE</p><h2 id="cup-media-title">赛事影像</h2></div><span>查看赛前、比赛与收官阶段的赛事影像。</span></div>
          <ArchiveGallery images={mensCupGallery} showCaptions ariaLabel="2026男子足球院际杯赛事照片" />
        </div>
      </section>
      <ArchiveDocuments href={competition.guidebook} source={competition.source} />
    </>
  );
}
