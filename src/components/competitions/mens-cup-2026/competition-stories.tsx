import { ArchiveDocuments } from "@/components/competitions/archive/archive-documents";
import { ArchiveGallery } from "@/components/competitions/archive/archive-gallery";
import { ArchiveReports } from "@/components/competitions/archive/archive-reports";
import { mensCupGallery, mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";

export function CompetitionStories() {
  const { competition, news } = mensIntercollegeCup2026;

  return (
    <>
      <ArchiveReports titleId="cup-stories-title" description="5篇正式报道记录赛前、决赛与收官节点。" stories={news} />
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
