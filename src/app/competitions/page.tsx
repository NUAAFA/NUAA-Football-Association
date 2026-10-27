import type { Metadata } from "next";
import { CompetitionHub } from "@/components/competitions/competition-hub";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getPublicCompetitionCatalog } from "@/lib/public-competition-service";
import { getCompetitionArchives, getStaticCompetitionArchives } from "@/lib/competition-archive-service";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions" },
  title: "赛事中心",
  description: "查看南京航空航天大学天目湖足球协会当前赛事、赛程、数据、文件与赛事服务。",
};
export const dynamic = "force-dynamic";

export default async function CompetitionsPage() {
  const [current, history] = await Promise.allSettled([getPublicCompetitionCatalog(), getCompetitionArchives()]);
  const competitions = current.status === "fulfilled" ? current.value.filter((entry) => entry.status !== "completed") : [];
  const archives = history.status === "fulfilled" ? history.value : getStaticCompetitionArchives();
  return <><SiteHeader /><CompetitionHub competitions={competitions} archives={archives} unavailable={current.status === "rejected"} archivesUnavailable={history.status === "rejected"} /><SiteFooter /></>;
}
