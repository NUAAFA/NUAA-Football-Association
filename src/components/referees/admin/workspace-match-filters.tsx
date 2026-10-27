import Link from "next/link";
import type { ReactNode } from "react";
import { logicalRounds } from "@/lib/competition-logical-rounds";

export type WorkspaceFilterStage = {
  id: string;
  name: string;
  type?: string;
  groups: Array<{ id: string; name: string }>;
  rounds: Array<{ id: string; name: string; groupId: string | null; sortOrder: number }>;
};

export function WorkspaceMatchFilters({ competitionId, stages, query, counts }: {
  competitionId: string;
  stages: WorkspaceFilterStage[];
  query: string;
  counts: { matches: number; pending: number; scheduled: number; completed: number; filtered: number };
}) {
  const params = new URLSearchParams(query);
  const stageId = params.get("stageId") ?? "";
  const groupId = params.get("groupId") ?? "";
  const roundId = params.get("roundId") ?? "";
  const root = `/admin/competitions/${competitionId}`;
  const visibleStages = stages.filter((stage) => !stageId || stage.id === stageId);
  const leagueOnly = visibleStages.length > 0 && visibleStages.every((stage) => stage.type === "LEAGUE");
  const rounds = logicalRounds(visibleStages.flatMap((stage) => stage.rounds.map((round) => ({ ...round, stageId: stage.id }))));
  function href(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    next.set("section", "matches");
    next.delete("page");
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return `${root}?${next}`;
  }
  function option(label: ReactNode, active: boolean, patch: Record<string, string>, key: string) {
    return <Link key={key} href={href(patch)} scroll={false} prefetch={false} aria-current={active ? "page" : undefined}>{label}</Link>;
  }
  function row(label: string, children: ReactNode) {
    return <nav className="admin-quick-filters admin-workspace-filter-row" aria-label={`赛程${label}`}><span>{label}</span><div>{children}</div></nav>;
  }
  return <div className="admin-workspace-match-filters">
    <div className="admin-workspace-filter-heading"><strong>筛选赛程</strong><Link href={`${root}?section=matches`} scroll={false} prefetch={false}>重置筛选</Link></div>
    {row("阶段", <>
      {option("全部阶段", !stageId, { stageId: "", roundId: "", groupId: "" }, "all")}
      {stages.map((stage) => option(stage.name, stageId === stage.id, { stageId: stage.id, roundId: "", groupId: "" }, stage.id))}
      {option("未结构化 / 待归类", stageId === "legacy", { stageId: "legacy", roundId: "", groupId: "" }, "legacy")}
    </>)}
    {row("轮次", <>
      {option("全部轮次", !roundId, { roundId: "" }, "all")}
      {rounds.map((round) => option(<>{round.label}{!stageId ? ` · ${stages.find((stage) => stage.id === round.stageId)?.name}` : ""}</>, roundId === round.key || round.ids.includes(roundId), { stageId: round.stageId, roundId: round.key, groupId: stageId && stageId !== round.stageId ? "" : groupId }, round.key))}
      {option("未归轮次", roundId === "unassigned", { roundId: "unassigned" }, "unassigned")}
    </>)}
    {!leagueOnly ? row("分组", <>
      {option("全部小组", !groupId, { groupId: "" }, "all")}
      {visibleStages.flatMap((stage) => stage.groups.map((group) => option(`${group.name}${!stageId ? ` · ${stage.name}` : ""}`, groupId === group.id, { stageId: stage.id, groupId: group.id, roundId: stageId && stageId !== stage.id ? "" : roundId }, group.id)))}
      {option("无小组 / 待归类", groupId === "unassigned", { groupId: "unassigned" }, "unassigned")}
    </>) : <p className="admin-filter-help">联赛无需分组，可直接按轮次和状态筛选。</p>}
    {row("状态", <>
      {option(`全部状态 ${counts.matches}`, !params.get("status"), { status: "" }, "all")}
      {([
        ["PENDING", "待排期", counts.pending],
        ["SCHEDULED", "待赛", counts.scheduled],
        ["COMPLETED", "已完赛", counts.completed],
        ["CANCELLED", "已取消", counts.matches - counts.pending - counts.scheduled - counts.completed],
      ] as const).map(([status, label, count]) => option(`${label} ${count}`, params.get("status") === status, { status }, status))}
    </>)}
    {row("排序", <>
      {option("按场序", params.get("sort") !== "time", { sort: "" }, "number")}
      {option("按时间 · 待定在最后", params.get("sort") === "time", { sort: "time" }, "time")}
    </>)}
    <p className="admin-workspace-filter-summary" role="status">当前筛选 <strong>{counts.filtered}</strong> / {counts.matches} 场<span>状态数量为本赛事总数，点击选项即筛选。</span></p>
  </div>;
}
