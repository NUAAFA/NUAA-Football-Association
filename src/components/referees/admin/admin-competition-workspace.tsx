"use client";
import { WorkspaceDialog } from "@/components/admin/workspace-dialog";
import { MatchSchedulingForm } from "@/components/admin/match-scheduling-form";

import Link from "next/link";
import { adminTabKeyboard } from "@/lib/admin-tab-keyboard";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { AdminCompetitionDangerActions } from "@/components/referees/admin/admin-competition-danger-actions";
import { OrganizationCheckboxSelector } from "@/components/referees/admin/organization-checkbox-selector";
import { parsePastedTeamNames, parseTeamCsv, type TeamImportPreview } from "@/lib/referee-team-import";

export type CompetitionWorkspaceUnit = {
  id: string;
  name: string;
  label: string;
  type: "COLLEGE" | "SHUYUAN";
};

export type CompetitionWorkspaceTeam = {
  id: string;
  name: string;
  teamType: "ORGANIZATION" | "JOINT" | "FREEFORM";
  unitIds: string[];
  matchCount: number;
};

async function teamApi(body: unknown) {
  const response = await fetch("/api/referees/admin/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, result: (await response.json()) as { error?: string } };
}

export function AdminCompetitionWorkspace({
  competition,
  units,
  teams,
  matches,
  canWrite,
  initialSection = "overview", counts, page, stages, publicEffect, structure, grouping, standings,
}: {
  competition: { id: string; name: string; formatLabel: string; statusLabel: string; year: number | null; slug: string; deletionProtectedReason?: string };
  units: CompetitionWorkspaceUnit[];
  teams: CompetitionWorkspaceTeam[];
  matches: Array<{ matchNumber?: number | null; id: string; matchup: string; kickoff: string; venue: string; pendingSchedule: boolean; canResult?: boolean; status: string; stage?: string; group?: string; round?: string; score?: string }>;
  canWrite: boolean;
  initialSection?: "overview" | "teams" | "matches" | "standings";
  counts: { teams: number; matches: number; pending: number; scheduled: number; completed: number; filtered: number }; page: number;
  stages: Array<{ id: string; name: string; groups: Array<{ id: string; name: string }>; rounds: Array<{ id: string; name: string; groupId: string | null }> }>;
  publicEffect: string; structure: ReactNode; grouping: ReactNode; standings: ReactNode;
}) {
  const router = useRouter(), params = useSearchParams();
  const section = initialSection;
  const [configOpen, setConfigOpen] = useState(false), [addOpen, setAddOpen] = useState(false);
  function navigate(key: string, value: string) { const next = new URLSearchParams(params.toString()); if (value) next.set(key, value); else next.delete(key); next.delete("page"); if (key === "stageId") { next.delete("groupId"); next.delete("roundId"); } if (key === "groupId") next.delete("roundId"); router.push(`/admin/competitions/${competition.id}?${next}`); }
  const setSection = (value: string) => navigate("section", value);
  const selectedStage = stages.find((s) => s.id === params.get("stageId"));
  const [selected, setSelected] = useState<string[]>([]);
  const [jointSelected, setJointSelected] = useState<string[]>([]);
  const [jointName, setJointName] = useState("");
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<TeamImportPreview>(() => parsePastedTeamNames("", teams.map((team) => team.name)));
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const existingUnitIds = useMemo(() => new Set(teams.filter((team) => team.teamType === "ORGANIZATION").flatMap((team) => team.unitIds)), [teams]);
  const selectorOptions = useMemo(() => units.map((unit) => ({
    id: unit.id,
    label: unit.label,
    description: unit.type === "COLLEGE" ? "学院" : "书院",
  })), [units]);

  async function createOrganizationTeams() {
    if (!selected.length) { setMessage("请至少选择一个尚未创建的组织单位。"); return; }
    setSubmitting(true);
    const { response, result } = await teamApi({ action: "from-units", competitionId: competition.id, unitIds: selected });
    setSubmitting(false);
    setMessage(response.ok ? `已完成批量创建请求（${selected.length} 个组织）。` : result.error ?? "代表队创建失败。");
    if (response.ok) { setSelected([]); router.refresh(); }
  }

  async function createJoint() {
    if (jointSelected.length < 2) { setMessage("联合队须选择至少两个组织单位。"); return; }
    setSubmitting(true);
    const { response, result } = await teamApi({ action: "joint", competitionId: competition.id, name: jointName, unitIds: jointSelected });
    setSubmitting(false);
    setMessage(response.ok ? `联合队“${jointName}”已创建。` : result.error ?? "联合队创建失败。");
    if (response.ok) { setJointName(""); setJointSelected([]); router.refresh(); }
  }

  function previewImport(value: string, csv = false) {
    setImportText(value);
    setImportPreview(csv ? parseTeamCsv(value, teams.map((team) => team.name)) : parsePastedTeamNames(value, teams.map((team) => team.name)));
  }

  async function createFreeformTeams() {
    if (!importPreview.names.length || importPreview.errors.length) { setMessage(importPreview.errors[0] ?? "没有可导入的新球队。"); return; }
    setSubmitting(true);
    const { response, result } = await teamApi({ action: "bulk", competitionId: competition.id, names: importPreview.names });
    setSubmitting(false);
    setMessage(response.ok ? `已导入 ${importPreview.names.length} 支自由组队球队。` : result.error ?? "球队导入失败。");
    if (response.ok) { previewImport(""); router.refresh(); }
  }

  return <>
    <nav aria-label="赛事工作台分区" className="admin-tabs admin-workspace-tabs" role="tablist" onKeyDown={adminTabKeyboard}>
      <button id="workspace-tab-overview" aria-controls="workspace-panel-overview" tabIndex={section === "overview" ? 0 : -1} aria-selected={section === "overview"} onClick={() => setSection("overview")} role="tab" type="button">赛事资料</button>
      <button id="workspace-tab-teams" aria-controls="workspace-panel-teams" tabIndex={section === "teams" ? 0 : -1} aria-selected={section === "teams"} onClick={() => setSection("teams")} role="tab" type="button">球队与分组（{counts.teams}）</button>
      <button id="workspace-tab-matches" aria-controls="workspace-panel-matches" tabIndex={section === "matches" ? 0 : -1} aria-selected={section === "matches"} onClick={() => setSection("matches")} role="tab" type="button">赛程与比分（{counts.matches}）</button>
      <button id="workspace-tab-standings" aria-controls="workspace-panel-standings" tabIndex={section === "standings" ? 0 : -1} aria-selected={section === "standings"} onClick={() => setSection("standings")} role="tab" type="button">积分与出线</button>
    </nav>

    {section === "overview" ? <section className="admin-panel" id="workspace-panel-overview" role="tabpanel" aria-labelledby="workspace-tab-overview" hidden={section !== "overview"}>
      <header className="admin-panel-header"><div><h2>赛事资料</h2><p>当前赛事上下文贯穿球队与赛程操作；公开发布开关不在本工作台中自动变更。</p></div>{canWrite ? <div className="admin-page-actions"><Link className="admin-button admin-button-secondary" href={`/admin/competitions/${competition.id}/edit`}>编辑赛事资料</Link><AdminCompetitionDangerActions competitionId={competition.id} competitionName={competition.name} protectedReason={competition.deletionProtectedReason} /></div> : null}</header>
      <p>{publicEffect}</p><Link href={`/competitions/${competition.slug}`}>查看官网效果</Link>
      <dl className="admin-detail-meta"><div><dt>赛事名称</dt><dd>{competition.name}</dd></div><div><dt>比赛制式</dt><dd>{competition.formatLabel}</dd></div><div><dt>状态</dt><dd>{competition.statusLabel}</dd></div><div><dt>年份</dt><dd>{competition.year ?? "未设置"}</dd></div><div><dt>页面地址标识</dt><dd>{competition.slug}</dd></div></dl>
    </section> : null}

    {section === "teams" ? <section className="admin-panel admin-workspace-team-panel" id="workspace-panel-teams" role="tabpanel" aria-labelledby="workspace-tab-teams" hidden={section !== "teams"}>
      <header className="admin-panel-header"><div><h2>球队与分组</h2><p>这里只管理“{competition.name}”的参赛球队，不会引入其他赛事的球队。</p></div>{canWrite ? <div className="admin-page-actions"><button className="admin-button" type="button" onClick={() => setAddOpen(true)}>添加球队</button><button className="admin-button admin-button-secondary" type="button" onClick={() => setConfigOpen(true)}>阶段与轮次</button></div> : null}</header>
      {grouping}
      {canWrite && addOpen ? <WorkspaceDialog title="添加球队" busy={submitting} onClose={() => setAddOpen(false)}><div className="admin-workspace-operations">
        <details><summary>添加组织代表队</summary><div className="admin-operation-body">
          <OrganizationCheckboxSelector legend="选择组织单位" lockedValues={[...existingUnitIds]} onChange={setSelected} options={selectorOptions} searchPlaceholder="搜索学院或书院…" selectedValues={selected} />
          <button className="admin-button" disabled={submitting || !selected.length} onClick={() => void createOrganizationTeams()} type="button">批量创建代表队</button>
        </div></details>
        <details><summary>创建联合队</summary><div className="admin-operation-body"><label><span>联合队名称</span><input maxLength={80} onChange={(event) => setJointName(event.target.value)} value={jointName} /></label><OrganizationCheckboxSelector legend="关联组织单位（至少两个）" onChange={setJointSelected} options={selectorOptions} selectedValues={jointSelected} /><button className="admin-button" disabled={submitting || !jointName.trim() || jointSelected.length < 2} onClick={() => void createJoint()} type="button">创建联合队</button></div></details>
        <details><summary>批量导入自由组队球队</summary><div className="admin-operation-body"><label><span>每行一个球队名称</span><textarea onChange={(event) => previewImport(event.target.value)} rows={7} value={importText} /></label><label className="admin-file-input"><span>或读取 CSV（name / 球队名称列）</span><input accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((value) => previewImport(value, true)); }} type="file" /></label><p>可创建 {importPreview.names.length} 支；当前赛事已存在 {importPreview.existing.length} 支；输入内重复 {importPreview.duplicates.length} 项。</p>{importPreview.errors.map((error) => <p className="admin-form-message" key={error}>{error}</p>)}<button className="admin-button" disabled={submitting || !importPreview.names.length || Boolean(importPreview.errors.length)} onClick={() => void createFreeformTeams()} type="button">批量导入球队</button></div></details>
      </div></WorkspaceDialog> : null}
      <p aria-live="polite" className="admin-form-message">{message}</p>
    </section> : null}

    {section === "matches" ? <section className="admin-panel" id="workspace-panel-matches" role="tabpanel" aria-labelledby="workspace-tab-matches" hidden={section !== "matches"}>
      <header className="admin-panel-header"><div><h2>赛程与比分</h2><p>共 {counts.matches} 场，待排期 {counts.pending} · 已安排 {counts.scheduled} · 已结束 {counts.completed} 场。新建比赛时赛事固定为当前上下文，主客队仅来自本赛事参赛球队。</p></div>{canWrite && teams.length ? <Link className="admin-button" href={`/admin/matches/new?competitionId=${competition.id}&stageId=${params.get("stageId") ?? ""}&groupId=${params.get("groupId") ?? ""}&roundId=${params.get("roundId") ?? ""}&from=workspace`}>+ 新建比赛</Link> : null}</header>
      <div className="admin-filter-bar"><label><span>排序</span><select value={params.get("sort") ?? "number"} onChange={(e) => navigate("sort", e.target.value)}><option value="number">按场序</option><option value="time">按时间（待定在最后）</option></select></label><label><span>阶段</span><select value={params.get("stageId") ?? ""} onChange={(e) => navigate("stageId", e.target.value)}><option value="">全部阶段</option><option value="legacy">旧记录 / 未结构化</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{selectedStage?.groups.length ? <label><span>小组</span><select value={params.get("groupId") ?? ""} onChange={(e) => navigate("groupId", e.target.value)}><option value="">全部小组</option>{selectedStage.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label> : null}{selectedStage ? <label><span>轮次</span><select value={params.get("roundId") ?? ""} onChange={(e) => navigate("roundId", e.target.value)}><option value="">全部轮次</option>{selectedStage.rounds.filter((r) => !r.groupId || !params.get("groupId") || r.groupId === params.get("groupId")).map((r) => <option key={r.id} value={r.id}>{r.groupId && !params.get("groupId") ? `${selectedStage.groups.find((g) => g.id === r.groupId)?.name ?? ""} · ` : ""}{r.name}</option>)}</select></label> : null}<label><span>状态</span><select value={params.get("status") ?? ""} onChange={(e) => navigate("status", e.target.value)}><option value="">全部</option><option value="PENDING">待排期</option><option value="SCHEDULED">已安排 / 待赛</option><option value="COMPLETED">已完赛</option><option value="CANCELLED">已取消</option></select></label></div>
      <div className="admin-page-actions">{canWrite ? <><button type="button" className="admin-button admin-button-secondary" onClick={() => setConfigOpen(true)}>阶段与轮次</button><Link className="admin-button admin-button-secondary" href={`/admin/competitions/import?competitionId=${competition.id}&kind=matches`}>导入赛程</Link></> : null}<span>当前筛选 {counts.filtered} 场</span></div>
      {!teams.length ? <div className="admin-empty-state"><strong>当前赛事尚无参赛球队。</strong><p>请先添加参赛球队，再创建比赛。</p><button className="admin-button" onClick={() => setSection("teams")} type="button">前往添加球队</button></div> : matches.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>比赛</th><th>时间</th><th>场地</th><th>阶段 / 组 / 轮次</th><th>状态 / 比分</th><th>操作</th></tr></thead><tbody>{matches.map((match) => <tr key={match.id}><td>{match.matchNumber ? <small>第{match.matchNumber}场</small> : null}<strong>{match.matchup}</strong></td><td>{match.kickoff}</td><td>{match.venue}</td><td>{[match.stage, match.group, match.round].filter(Boolean).join(" · ") || "未结构化"}</td><td>{match.score || (match.pendingSchedule && match.status === "SCHEDULED" ? "待排期" : match.status === "COMPLETED" ? "已结束，待核验比分" : match.status === "CANCELLED" ? "已取消" : "已安排")}</td><td className="ops-match-actions">{canWrite && match.pendingSchedule && match.status === "SCHEDULED" ? <MatchSchedulingForm matchId={match.id} /> : null}<Link href={`/admin/matches/${match.id}`}>{canWrite && match.canResult ? "录入赛果" : "详情"}</Link>{canWrite && !match.pendingSchedule && match.status === "SCHEDULED" ? <Link href={`/admin/matches/${match.id}/edit`}>修改安排</Link> : null}</td></tr>)}</tbody></table></div> : <div className="admin-empty-state"><strong>当前赛事尚无比赛</strong><p>参赛球队已就绪，可以创建第一场比赛。</p></div>}
      <nav className="admin-pagination" aria-label="赛事比赛分页">{page > 1 ? <Link href={`?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page - 1) })}`}>上一页</Link> : null}<span>{page} / {Math.max(1, Math.ceil(counts.filtered / 30))}</span>{page * 30 < counts.filtered ? <Link href={`?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page + 1) })}`}>下一页</Link> : null}</nav>
    </section> : null}
    {section === "standings" ? <section id="workspace-panel-standings" role="tabpanel" aria-labelledby="workspace-tab-standings">{standings}</section> : null}
    {configOpen ? <WorkspaceDialog title="阶段与轮次" onClose={() => setConfigOpen(false)}>{structure}</WorkspaceDialog> : null}
  </>;
}
