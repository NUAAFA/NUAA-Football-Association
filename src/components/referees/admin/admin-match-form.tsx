"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { adminTabKeyboard } from "@/lib/admin-tab-keyboard";
import { matchStatusLabels } from "@/components/referees/admin/admin-ui";

export type PositionDefinition = { key: string; label: string };
export type CompetitionOption = {
  id: string;
  name: string;
  format: "ELEVEN_A_SIDE" | "FUTSAL" | "CUSTOM";
  playingFormat: string;
  teams: Array<{ id: string; name: string; teamType: "ORGANIZATION" | "JOINT" | "FREEFORM"; unitIds: string[] }>;
  positions: PositionDefinition[];
};
export type OrganizationUnitOption = {
  id: string;
  name: string;
  label: string;
  type: "COLLEGE" | "SHUYUAN";
};
export type AdminMatchRecord = {
  stageId?: string | null; groupId?: string | null; roundId?: string | null;
  id: string; slug: string; competitionId: string; stage: string; kickoff: string; endAt: string;
  venue: string; round: string; source: string; externalMatchId: string; homeTeamId: string; awayTeamId: string;
  status: string; applicationWindowStatus: string; applicationDeadline: string; publicNote: string;
  internalNote: string; cancellationReason: string; positionCounts: Record<string, number>;
};

function formText(form: FormData, name: string) { return String(form.get(name) ?? ""); }

function payload(form: FormData, definitions: PositionDefinition[]) {
  return {
    stageId: formText(form, "stageId") || null, groupId: formText(form, "groupId") || null, roundId: formText(form, "roundId") || null,
    structureChangeReason: formText(form, "structureChangeReason"),
    slug: formText(form, "slug"), competitionId: formText(form, "competitionId"), stage: formText(form, "stage"),
    kickoff: formText(form, "kickoff"), endAt: formText(form, "endAt"), venue: formText(form, "venue"),
    round: formText(form, "round"), source: formText(form, "source") || "MANUAL", externalMatchId: formText(form, "externalMatchId"),
    status: formText(form, "status"),
    applicationWindowStatus: formText(form, "applicationWindowStatus"), applicationDeadline: formText(form, "applicationDeadline"),
    publicNote: formText(form, "publicNote"), internalNote: formText(form, "internalNote"), cancellationReason: formText(form, "cancellationReason"),
    positionCounts: Object.fromEntries(definitions.map((position) => [position.key, Number(form.get(`position-${position.key}`) ?? 0)])),
  };
}

function existingTeamId(selection: string) {
  return selection.startsWith("team:") ? selection.slice(5) : "";
}

function PositionCounts({ definitions, defaults = {} }: { definitions: PositionDefinition[]; defaults?: Record<string, number> }) {
  return <div className="admin-position-count-grid">{definitions.map((position) => <label key={position.key}><span>{position.label}</span><input defaultValue={defaults[position.key] ?? 0} max={5} min={0} name={`position-${position.key}`} type="number" /></label>)}</div>;
}

export function AdminMatchForm({
  competitions,
  organizationUnits,
  initialCompetitionId = "",
  lockCompetition = false,
  match,
}: {
  competitions: CompetitionOption[];
  organizationUnits: OrganizationUnitOption[];
  initialCompetitionId?: string;
  lockCompetition?: boolean;
  match?: AdminMatchRecord;
}) {
  const router = useRouter();
  const query = useSearchParams();
  const [stageId, setStageId] = useState(match?.stageId ?? query.get("stageId") ?? "");
  const [groupId, setGroupId] = useState(match?.groupId ?? query.get("groupId") ?? "");
  const [roundId, setRoundId] = useState(match?.roundId ?? query.get("roundId") ?? "");
  const [qualified, setQualified] = useState<Record<string, string>>({});
  const [structures, setStructures] = useState<Array<{ id: string; name: string; type: string; groups: Array<{ id: string; name: string; members: Array<{ teamId: string }> }>; rounds: Array<{ id: string; name: string; groupId: string | null }> }>>([]);
  const [busy, setBusy] = useState(false);

  const [competitionId, setCompetitionId] = useState(
    match?.competitionId
      ?? (competitions.some((item) => item.id === initialCompetitionId) ? initialCompetitionId : ""),
  );
  const [homeTeamSelection, setHomeTeamSelection] = useState(match ? `team:${match.homeTeamId}` : "");
  const [awayTeamSelection, setAwayTeamSelection] = useState(match ? `team:${match.awayTeamId}` : "");
  const [tab, setTab] = useState<"basic" | "assignment" | "notes">("basic");
  const [message, setMessage] = useState("");
  const competition = competitions.find((item) => item.id === competitionId);
  useEffect(() => { if (!competitionId) return; let live = true; fetch(`/api/admin/competitions/${competitionId}/structure`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "结构读取失败"); if (live) { setStructures(d.stages); setQualified(Object.fromEntries(d.tables.flatMap((t: { group: { name: string }; qualifiedTeamIds: string[] }) => t.qualifiedTeamIds.map((id, i) => [id, `${t.group.name}第${i + 1}位 · 人工确认出线`])))); } }).catch((e) => { if (live) setMessage(e.message); }); return () => { live = false; }; }, [competitionId]);
  const selectedStage = structures.find((s) => s.id === stageId), selectedGroup = selectedStage?.groups.find((g) => g.id === groupId);
  const completedStructureChange = match?.status === "COMPLETED" && (stageId !== (match.stageId ?? "") || groupId !== (match.groupId ?? "") || roundId !== (match.roundId ?? ""));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!competition || busy) return;
    if (!homeTeamSelection || !awayTeamSelection) {
      setMessage("请选择主队和客队。");
      return;
    }
    if (homeTeamSelection === awayTeamSelection) {
      setMessage("比赛双方不能相同。");
      return;
    }
    const formElement = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    setBusy(true);
    try {
    const basePayload = payload(new FormData(event.currentTarget), competition.positions);
    if (selectedStage && !match) basePayload.stage = selectedStage.name;
    const response = await fetch(match ? `/api/referees/admin/matches/${match.id}` : "/api/referees/admin/matches", {
      method: match ? "PATCH" : "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(match
        ? { ...basePayload, homeTeamId: existingTeamId(homeTeamSelection), awayTeamId: existingTeamId(awayTeamSelection) }
        : { ...basePayload, homeTeamSelection, awayTeamSelection }),
    });
    const result = (await response.json()) as { error?: string; id?: string; matchId?: string };
    if (!response.ok) throw new Error(result.error ?? "保存失败。");
    const id = match?.id ?? result.matchId ?? result.id;
    const continueCreating = submitter?.value === "continue";
    if (continueCreating && !match) { const form = formElement; for (const name of ["slug", "kickoff", "endAt", "externalMatchId", "applicationDeadline", "cancellationReason", "publicNote", "internalNote"]) { const field = form.elements.namedItem(name) as HTMLInputElement | null; if (field) field.value = ""; } const status = form.elements.namedItem("status") as HTMLSelectElement | null; if (status) status.value = "SCHEDULED"; setHomeTeamSelection(""); setAwayTeamSelection(""); setMessage("已保存，继续创建；阶段、组、轮次、场地和岗位配置保留。"); }
    else router.push(id ? `/admin/matches/${id}` : "/admin/matches");
    router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "保存失败。"); } finally { setBusy(false); }
  }
  async function copy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!match || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
    const response = await fetch(`/api/referees/admin/matches/${match.id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "copy", slug: form.get("copySlug"), stage: form.get("copyStage"), kickoff: form.get("copyKickoff") }),
    });
    const result = (await response.json()) as { error?: string };
    setMessage(response.ok ? "场次副本已创建并保持关闭报名。" : result.error ?? "复制失败。");
    if (response.ok) router.push("/admin/matches");
    } catch (error) { setMessage(error instanceof Error ? error.message : "复制失败，请重试。"); } finally { setBusy(false); }
  }
  void organizationUnits;
  function teamOptions() {
    if (!competition) return <option value="">请先选择赛事</option>;
    return <>
      <option value="">请选择球队</option>
      {competition.teams.length ? <optgroup label="当前赛事参赛球队">{competition.teams.filter((t) => !groupId || selectedGroup?.members.some((m) => m.teamId === t.id)).map((team) => <option key={team.id} value={`team:${team.id}`}>{team.name}{selectedStage?.type === "KNOCKOUT" && qualified[team.id] ? `（${qualified[team.id]}）` : ""}</option>)}</optgroup> : null}
    </>;
  }
  return <>
    <form className="admin-form" onSubmit={submit}>
      <nav aria-label="比赛表单分区" className="admin-tabs" role="tablist" onKeyDown={adminTabKeyboard}><button id="match-tab-basic" aria-controls="match-panel-basic" tabIndex={tab === "basic" ? 0 : -1} aria-selected={tab === "basic"} onClick={() => setTab("basic")} role="tab" type="button">比赛信息</button><button id="match-tab-assignment" aria-controls="match-panel-assignment" tabIndex={tab === "assignment" ? 0 : -1} aria-selected={tab === "assignment"} onClick={() => setTab("assignment")} role="tab" type="button">报名与岗位</button><button id="match-tab-notes" aria-controls="match-panel-notes" tabIndex={tab === "notes" ? 0 : -1} aria-selected={tab === "notes"} onClick={() => setTab("notes")} role="tab" type="button">说明与来源</button></nav>
      <section className="admin-form-section" id="match-panel-basic" role="tabpanel" aria-labelledby="match-tab-basic" hidden={tab !== "basic"}><header><h2>比赛信息</h2><p>维护赛程、双方、场地与当前比赛状态。</p></header><div className="admin-form-grid admin-form-grid-3">
        <label><span>所属赛事</span>{match || lockCompetition ? <><div className="admin-form-readonly"><strong>{competition?.name ?? "赛事不存在"}</strong><small>{competition?.playingFormat ?? "比赛制式待确认"}</small></div><input name="competitionId" type="hidden" value={competitionId} /></> : <><select name="competitionId" onChange={(event) => { setCompetitionId(event.target.value); setHomeTeamSelection(""); setAwayTeamSelection(""); setStageId(""); setGroupId(""); setRoundId(""); }} required value={competitionId}><option value="">请选择赛事</option>{competitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>选择赛事后再选择参赛球队。</small></>}</label>
        <label><span>页面标识</span><input defaultValue={match?.slug} name="slug" required /></label>
        <label><span>正式阶段</span><select name="stageId" value={stageId} onChange={(e) => { setStageId(e.target.value); setGroupId(""); setRoundId(""); setHomeTeamSelection(""); setAwayTeamSelection(""); }}><option value="">旧记录 / 未结构化</option>{structures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{selectedStage?.type === "GROUP" ? <label><span>小组</span><select name="groupId" required value={groupId} onChange={(e) => { setGroupId(e.target.value); setRoundId(""); setHomeTeamSelection(""); setAwayTeamSelection(""); }}><option value="">选择小组</option>{selectedStage.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label> : <input name="groupId" value="" type="hidden" />}{selectedStage ? <label><span>正式轮次</span><select name="roundId" value={roundId} onChange={(e) => setRoundId(e.target.value)}><option value="">暂不指定</option>{selectedStage.rounds.filter((r) => !r.groupId || r.groupId === groupId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label> : <input name="roundId" value="" type="hidden" />}
        <label><span>阶段文字（保留历史）</span><input defaultValue={match?.stage} name="stage" required={!stageId} /></label>
        <label><span>标准轮次</span><input defaultValue={match?.round} name="round" /></label>
        <label><span>开球时间</span><input defaultValue={match?.kickoff} name="kickoff" required type="datetime-local" /></label>
        <label><span>预计结束</span><input defaultValue={match?.endAt} name="endAt" type="datetime-local" /></label>
        <label><span>比赛场地</span><input defaultValue={match?.venue ?? query.get("venue") ?? ""} name="venue" required /></label>
        <label><span>主队</span><select disabled={!competition} onChange={(event) => setHomeTeamSelection(event.target.value)} required value={homeTeamSelection}>{teamOptions()}</select><small>{competition ? "仅显示当前赛事的参赛球队。" : "请先选择赛事"}</small></label>
        <label><span>客队</span><select disabled={!competition} onChange={(event) => setAwayTeamSelection(event.target.value)} required value={awayTeamSelection}>{teamOptions()}</select><small>{competition ? "如需新增球队，请返回赛事工作台。" : "请先选择赛事"}</small></label>
        <label><span>比赛状态</span><select defaultValue={match?.status ?? "SCHEDULED"} name="status">{Object.entries(matchStatusLabels).filter(([value]) => value !== "COMPLETED" || match?.status === "COMPLETED").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>取消原因</span><input defaultValue={match?.cancellationReason} name="cancellationReason" /></label>
        {completedStructureChange ? <label className="admin-form-span-2"><span>已完赛比赛重新归类原因（必填）</span><textarea name="structureChangeReason" required maxLength={500} /><small>重新归类会重新计算相关组积分，并使原排名、出线依据待复核；历史文字、比分和选派记录保留。</small><span><input name="confirmStructureChange" type="checkbox" required />我已核对归类及积分影响</span></label> : null}
      </div></section>
      <section className="admin-form-section" id="match-panel-assignment" role="tabpanel" aria-labelledby="match-tab-assignment" hidden={tab !== "assignment"}><header><h2>报名与岗位</h2><p>岗位名称由当前比赛制式模板集中维护。</p></header><div className="admin-form-grid">
        <label><span>报名窗口</span><select defaultValue={match?.applicationWindowStatus ?? "CLOSED"} name="applicationWindowStatus"><option value="CLOSED">关闭</option><option disabled={competition?.format === "CUSTOM"} value="OPEN">开放</option></select>{competition?.format === "CUSTOM" ? <small>该赛事暂未配置对应的裁判岗位模板，不能开放裁判报名。</small> : null}</label>
        <label><span>报名截止</span><input defaultValue={match?.applicationDeadline} name="applicationDeadline" type="datetime-local" /></label>
      </div>{competition?.format === "CUSTOM" ? <div className="admin-empty-state"><strong>无预设裁判岗位模板</strong><p>该赛事可正常维护球队与比赛，但暂不提供自动岗位、报名或选派。</p></div> : competition ? <PositionCounts defaults={match?.positionCounts} definitions={competition.positions} /> : null}</section>
      <section className="admin-form-section" id="match-panel-notes" role="tabpanel" aria-labelledby="match-tab-notes" hidden={tab !== "notes"}><header><h2>说明与来源</h2><p>保留后续数据接入所需字段；当前仅维护本地赛事资料。</p></header><div className="admin-form-grid">
        <label><span>数据来源</span><select defaultValue={match?.source ?? "MANUAL"} name="source"><option value="MANUAL">手工维护</option><option value="FOOTBALL_CHINA">足球中国</option></select></label>
        <label><span>外部比赛 ID</span><input defaultValue={match?.externalMatchId} name="externalMatchId" placeholder="当前不自行生成" /></label>
      </div><label><span>公开说明</span><textarea defaultValue={match?.publicNote} name="publicNote" /></label><label><span>内部备注</span><textarea defaultValue={match?.internalNote} name="internalNote" /></label></section>
      <p aria-live="polite" className="admin-form-message">{message}</p>
      <footer><button className="admin-button admin-button-secondary" onClick={() => router.back()} type="button">取消</button>{!match ? <button className="admin-button admin-button-secondary" disabled={busy} value="continue" type="submit">保存并继续创建</button> : null}<button className="admin-button" disabled={busy} type="submit">{match ? "保存比赛" : "创建比赛"}</button></footer>
    </form>
    {match ? <form className="admin-copy-form" onSubmit={copy}><header><strong>复制为新场次</strong><span>副本默认关闭报名。</span></header><input aria-label="新页面标识" name="copySlug" placeholder="新页面标识" required /><input aria-label="新阶段文字" name="copyStage" placeholder="新阶段" required /><input aria-label="复制后的开球时间" name="copyKickoff" required type="datetime-local" /><button disabled={busy} className="admin-button admin-button-secondary" type="submit">复制比赛</button></form> : null}
  </>;
}
