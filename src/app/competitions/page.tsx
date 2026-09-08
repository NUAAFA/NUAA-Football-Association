import type { Metadata } from "next";

import { CompetitionHub } from "@/components/competitions/competition-hub";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions" },
  title: "赛事中心",
  description: "查看南京航空航天大学天目湖足球协会当前赛事、赛程、数据、文件与赛事服务。",
};

export default function CompetitionsPage() {
  return (
    <>
      <SiteHeader />
      <CompetitionHub />
      <SiteFooter />
    </>
  );
}
