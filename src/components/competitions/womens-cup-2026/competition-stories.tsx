import Image from "@/components/ui/site-image";

import { ArchiveGallery } from "@/components/competitions/archive/archive-gallery";
import { ArchiveHonours } from "@/components/competitions/archive/archive-honours";
import { ArchiveReports } from "@/components/competitions/archive/archive-reports";
import { womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";

export function WomensCompetitionHonours() {
  const { awardList, competition, gallery, matches, podium } = womensIntercollegeCup2026;
  const final = matches.find((match) => match.stage === "决赛");
  const championPhoto = gallery.find((photo) => photo.src.endsWith("15-champion-team.jpg"))!;
  return (
    <section className="cup-archive-section cup-final-section" id="honours" aria-labelledby="womens-honours-title">
      <div className="page-shell">
        <div className="cup-section-heading cup-section-heading-light"><div><p>HONOURS & FINAL</p><h2 id="womens-honours-title">名次与奖项</h2></div><span>来源：校级官方账号报道。</span></div>
        <ArchiveHonours
          rankings={podium.map((item) => ({ position: item.rank, team: item.team, note: "note" in item ? item.note : undefined }))}
          awards={awardList.map((award) => ({ name: award.award, recipient: award.recipient, ...("note" in award ? { note: award.note } : {}) }))}
        />
        {final ? <div className="cup-final-story">
          <div className="cup-final-image"><Image src={championPhoto.src} alt={championPhoto.alt} fill sizes="(max-width: 900px) 100vw, 50vw" /></div>
          <article className="cup-final-scorecard">
            <p>CHAMPIONSHIP MATCH</p><span>{final.kickoff.split(" ")[0].replaceAll("-", ".")} · {competition.venue}</span>
            <div className="cup-final-score"><strong>{final.home}</strong><b>{final.homeScore}<i>:</i>{final.awayScore}</b><strong>{final.away}</strong></div>
            <p className="cup-final-penalty">{podium[0].team}夺得冠军</p>
            <dl><div><dt>正式开球</dt><dd>{final.kickoff.split(" ")[1]}</dd></div><div><dt>比赛形式</dt><dd>{competition.format}</dd></div></dl>
          </article>
        </div> : null}
      </div>
    </section>
  );
}

export function WomensCompetitionStories() {
  const { competition, gallery, news } = womensIntercollegeCup2026;
  return (
    <>
      <ArchiveReports titleId="womens-story-title" description={`来源：${competition.sourceArticlePublisher} · ${competition.sourceArticlePublishedAt}`} stories={[news]} />
      <section className="cup-archive-section cup-archive-section-tint" id="media" aria-labelledby="womens-gallery-title">
        <div className="page-shell"><div className="cup-section-heading"><div><p>PHOTO ARCHIVE</p><h2 id="womens-gallery-title">赛事影像</h2></div><span>16张赛事照片记录比赛、颁奖与团队合影。</span></div><ArchiveGallery images={gallery} showCaptions ariaLabel="2026女子足球院际杯16张赛事原始照片" /></div>
      </section>
    </>
  );
}
