import type { Metadata } from "next";

import { FormalPageHeader } from "@/components/competitions/formal-page-header";
import formal from "@/components/competitions/formal-services.module.css";
import { CompetitionFileCenter } from "@/components/competitions/competition-file-center";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { publicCompetitionFiles } from "@/data/competition-center";

export const metadata: Metadata = {
  alternates: { canonical: "/competitions/files" },
  title: "赛事文件中心",
  description: "面向赛事组织、参赛球队和公众的竞赛规则、秩序册与纪律决定下载。",
};

export default function CompetitionFilesPage() {
  return (
    <>
      <SiteHeader />
      <main className={formal.page} id="main-content">
        <FormalPageHeader title="赛事文件中心" eyebrow="COMPETITION DOCUMENTS" description="查阅竞赛规则、赛事秩序册与公开纪律决定，查看或下载真实原文件。裁判组专用工作表单已归入裁判中心。" />
        <section className={formal.section}>
          <div className="page-shell">
            <div className={formal.notice}><strong>文件治理说明</strong><p>下载文件保持原始内容，不提取或公开身份证号、手机号等敏感字段。使用前请确认适用赛事与版本。</p></div>
            <CompetitionFileCenter files={publicCompetitionFiles} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
