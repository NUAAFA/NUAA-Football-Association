import Link from "next/link";
import type { Metadata } from "next";

import { FormalPageHeader } from "@/components/competitions/formal-page-header";
import formal from "@/components/competitions/formal-services.module.css";
import styles from "./history.module.css";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { coreCompetitionDirectory } from "@/data/competition-directory";
import { historicalCompetitionYears } from "@/data/historical-competitions";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/history" },
  title: "历届赛事",
  description: "南京航空航天大学天目湖足球协会年度赛事档案与赛季记录。",
  openGraph: {
    title: "历届赛事 | 南京航空航天大学天目湖足球协会",
    description: "查看2026赛事完整档案及2025、2024年已核实的历史赛事记录。",
    url: "/competitions/history",
  },
};

const archives2026 = coreCompetitionDirectory.filter((competition) =>
  ["mens-intercollege-cup", "womens-intercollege-cup"].includes(competition.id),
);

export default function CompetitionHistoryPage() {
  return (
    <>
      <SiteHeader />
      <main className={formal.page} id="main-content">
        <FormalPageHeader title="历届赛事" eyebrow="COMPETITION HISTORY" description="按年度查找已结束赛事的完整档案与已核实的历史记录。" />
        <div className="page-shell">
          <nav className={styles.years} aria-label="赛事年度索引">
            <span>浏览年度</span>
            <a href="#history-2026">2026 · 赛事档案</a>
            {historicalCompetitionYears.map((year) => <a key={year.year} href={`#history-${year.year}`}>{year.year} · 历史记录</a>)}
          </nav>
        </div>
        <section className={formal.section} id="history-2026" aria-labelledby="archives-title"><div className="page-shell">
          <div className={formal.sectionHeading}><h2 id="archives-title">2026 年度赛事档案</h2><p>男子、女子足球院际杯已结束，进入档案查看赛果、球队与赛事报道。</p></div>
          <div className={styles.archives}>
              {archives2026.map((competition) => <article key={competition.id}><div><span>{competition.formatLabel} · {competition.campus}</span><h3>{competition.name}</h3><p>{competition.summary}</p></div><dl><div><dt>赛事状态</dt><dd>{competition.statusLabel}</dd></div><div><dt>比赛周期</dt><dd>{competition.matchWindow}</dd></div></dl><Link className="ui-button ui-button-secondary" href={competition.detailHref} aria-label={`查看${competition.name}完整赛事档案`}>查看完整赛事档案 <span aria-hidden="true">→</span></Link></article>)}
          </div>
        </div></section>
        <div className="page-shell">
          <div className={styles.history}>
            {historicalCompetitionYears.map((year) => (
              <section className={formal.section} id={`history-${year.year}`} key={year.year} aria-labelledby={`year-title-${year.year}`}>
                <header className={formal.sectionHeading}><h2 id={`year-title-${year.year}`}>{year.year} 年度赛事记录</h2><p>{year.competitions.length} 项已核实记录 · 展开查看现有赛果、名次与裁判信息。</p></header>
                <div className={styles.records}>
                  {year.competitions.map((competition) => (
                    <article className={styles.record} key={competition.id}>
                      <div className={styles.recordHeading}>
                        <span>{competition.format ?? "历史赛事"}</span>
                        <h3>{competition.name}</h3>
                      </div>
                      <details className={styles.details}>
                        <summary aria-label={`查看${competition.name}历史记录`}>查看历史记录<span aria-hidden="true">＋</span></summary>
                        <div className={styles.recordBody}>
                          {competition.teamCount || competition.startDate || competition.venue ? (
                            <dl className={styles.facts}>
                              {competition.teamCount ? <div><dt>参赛队伍</dt><dd>{competition.teamCount}支</dd></div> : null}
                              {competition.startDate ? <div><dt>赛事起始日期</dt><dd>{competition.startDate}</dd></div> : null}
                              {competition.venue ? <div><dt>决赛场地</dt><dd>{competition.venue}</dd></div> : null}
                            </dl>
                          ) : null}
                          {competition.final ? (
                            <section className={styles.final}>
                              <span>决赛</span>
                              <div><strong>{competition.final.home}</strong><b>{competition.final.score}</b><strong>{competition.final.away}</strong></div>
                              <small>{competition.final.date}</small>
                            </section>
                          ) : null}
                          {competition.standings?.length ? (
                            <section className={styles.ranking}>
                              <h4>{year.year === 2024 ? "公开名次" : "最终名次"}</h4>
                              <ol>
                                {competition.standings.map((standing) => (
                                  <li key={`${competition.id}-${standing.position}`}>
                                    <span>{standing.position}</span>
                                    <div><strong>{standing.team}</strong>{standing.record ? <small>{standing.record}{standing.goals ? ` · 进/失 ${standing.goals}` : ""}</small> : null}</div>
                                    {standing.points !== undefined ? <b>{standing.points}分</b> : null}
                                  </li>
                                ))}
                              </ol>
                            </section>
                          ) : null}
                          {competition.officials?.length ? (
                            <section className={styles.officials}><h4>决赛裁判组</h4><dl>{competition.officials.map((official) => <div key={official.role}><dt>{official.role}</dt><dd>{official.name}</dd></div>)}</dl></section>
                          ) : null}
                          {competition.note ? <p className={styles.note}>{competition.note}</p> : null}
                        </div>
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
