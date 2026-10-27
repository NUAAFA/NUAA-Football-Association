import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HistoricalRecordDetails } from "@/components/competitions/historical-record-details";
import { FormalPageHeader } from "@/components/competitions/formal-page-header";
import formal from "@/components/competitions/formal-services.module.css";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import styles from "@/components/ui/catalogue.module.css";
import { historicalCompetitionYears } from "@/data/historical-competitions";

function findRecord(id: string) {
  for (const year of historicalCompetitionYears) {
    const competition = year.competitions.find((entry) => entry.id === id);
    if (competition) return { competition, year: year.year };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const record = findRecord((await params).id);
  return { title: record?.competition.name ?? "历史记录未找到", alternates: { canonical: `/competitions/history/${(await params).id}` } };
}

export default async function HistoricalRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const record = findRecord((await params).id);
  if (!record) notFound();
  return <><SiteHeader /><main className={formal.page} id="main-content">
    <div className="page-shell"><nav className={styles.breadcrumb} aria-label="历史赛事位置"><Link href={`/competitions/history?year=${record.year}`}>← 返回 {record.year} 年度赛事</Link><span aria-hidden="true">/</span><span>历史记录</span></nav></div>
    <FormalPageHeader title={record.competition.name} eyebrow={`${record.year} / COMPETITION RECORD`} description="已核实的历史赛事资料" />
    <section className={formal.section}><div className="page-shell"><HistoricalRecordDetails {...record} /></div></section>
  </main><SiteFooter /></>;
}
