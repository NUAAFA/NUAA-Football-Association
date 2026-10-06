import Image from "next/image";
import Link from "next/link";

import { ArchiveDocuments } from "@/components/competitions/archive/archive-documents";
import { ArchiveGallery } from "@/components/competitions/archive/archive-gallery";
import { mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";
import type { ArchiveGalleryImage } from "@/types";

const imageRoot = "/images/competitions/2026-mens-intercollege-cup";

const gallery = [
  { src: `${imageRoot}/stadium-sunset.jpg`, alt: "天目湖校区西操场晚霞与足球", width: 2048, height: 1536 },
  { src: `${imageRoot}/joint-meeting.jpg`, alt: "2026男子足球院际杯赛前联席会议现场", width: 1706, height: 1279 },
  { src: `${imageRoot}/group-draw.jpg`, alt: "参赛球队代表参加小组抽签", width: 1280, height: 443 },
  { src: `${imageRoot}/civil-aviation-squad.jpg`, alt: "民航通飞联队赛前集体合影", width: 1280, height: 960 },
  { src: `${imageRoot}/team-portrait-zhihui-day.jpg`, alt: "致慧书院球队日间合影", width: 1706, height: 1279 },
  { src: `${imageRoot}/zhihui-lineup-night.jpg`, alt: "致慧书院球队夜间列队", width: 1080, height: 576 },
  { src: `${imageRoot}/group-stage-team-orange.jpg`, alt: "小组赛参赛球队赛前合影", width: 1080, height: 494 },
  { src: `${imageRoot}/assistant-referee-action.jpg`, alt: "助理裁判员在边线执裁", width: 2048, height: 1365 },
  { src: `${imageRoot}/referee-match-management.jpg`, alt: "裁判员在比赛中进行现场管理", width: 1280, height: 853 },
  { src: `${imageRoot}/referee-player-discussion.jpg`, alt: "裁判员与球员在比赛中沟通", width: 1280, height: 853 },
  { src: `${imageRoot}/finalist-civil-aviation-team.jpg`, alt: "民航通飞联队决赛阵容合影", width: 1080, height: 572 },
  { src: `${imageRoot}/final-action-civil-aviation.jpg`, alt: "民航通飞联队球员在决赛中推进", width: 1280, height: 853 },
  { src: `${imageRoot}/final-corner-zhihui.jpg`, alt: "致慧书院在决赛中准备角球", width: 1280, height: 853 },
  { src: `${imageRoot}/final-goal-zhihui.jpg`, alt: "致慧书院球员在决赛中完成射门", width: 993, height: 559 },
  { src: `${imageRoot}/final-goal-celebration-zhihui.jpg`, alt: "致慧书院球员庆祝决赛进球", width: 1080, height: 607 },
  { src: `${imageRoot}/final-huddle-zhihui.jpg`, alt: "致慧书院球员在决赛中围拢鼓劲", width: 1280, height: 853 },
  { src: `${imageRoot}/final-officials-lineup.jpg`, alt: "2026男子足球院际杯决赛裁判组列队", width: 1280, height: 853 },
  { src: `${imageRoot}/final-officials-awards.jpg`, alt: "决赛裁判组参加赛事颁奖环节", width: 1280, height: 853 },
  { src: `${imageRoot}/final-celebration-zhihui.jpg`, alt: "致慧书院球员在点球大战获胜后庆祝", width: 1080, height: 607 },
  { src: `${imageRoot}/final-celebration-civil-aviation.jpg`, alt: "民航通飞联队球员赛后相互致意", width: 1080, height: 607 },
  { src: `${imageRoot}/final-celebration-pose.jpg`, alt: "球员在决赛结束后合影留念", width: 1280, height: 853 },
  { src: `${imageRoot}/champion-zhihui-team.jpg`, alt: "致慧书院冠军队合影", width: 1280, height: 853 },
  { src: `${imageRoot}/champion-zhihui-medals.jpg`, alt: "致慧书院球员展示冠军奖牌", width: 1280, height: 853 },
  { src: `${imageRoot}/final-live-poster.jpg`, alt: "2026男子足球院际杯决赛直播预告海报", width: 1677, height: 938 },
] as const satisfies readonly ArchiveGalleryImage[];

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
          <ArchiveGallery images={gallery} showCaptions ariaLabel="2026男子足球院际杯赛事照片" />
        </div>
      </section>
      <ArchiveDocuments href={competition.guidebook} source={competition.source} />
    </>
  );
}
