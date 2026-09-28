import Link from "next/link";

import { CompetitionImportManager } from "@/components/admin/competition-import-manager";
import { AdminPageHeader } from "@/components/referees/admin/admin-ui";
import { prisma } from "@/lib/prisma";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

export default async function UnifiedCompetitionImportPage({ searchParams }: { searchParams: Promise<{ competitionId?: string; kind?: string }> }) {
  const query = await searchParams;
  await guardUnifiedAdminPage("competitions:write", "competition-import");
  const competitions = await prisma.competition.findMany({
    select: { id: true, name: true, year: true },
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
  });
  return <>
    <AdminPageHeader
      eyebrow="COMPETITION IMPORT"
      title="赛事批量导入"
      description="补充现有赛事的球队或赛程：选择输入、对应列、检查并确认导入。"
      actions={<><Link className="admin-button admin-button-secondary" href="/admin/competitions">返回赛事管理</Link><Link className="admin-button admin-button-secondary" href="/admin/matches">手动维护比赛</Link></>}
    />
    {!competitions.length ? <section className="admin-panel"><div className="admin-empty-state"><strong>请先创建赛事</strong><p>批量导入用于补充现有赛事的球队与比赛，请先建立赛事资料。</p><Link className="admin-button" href="/admin/competitions/new">手动创建赛事</Link></div></section> : <CompetitionImportManager competitions={competitions} initialCompetitionId={query.competitionId} initialType={query.kind === "matches" ? "MATCH" : "TEAM"} />}
  </>;
}
