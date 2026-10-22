"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./team-directory-manager.module.css";

type Settings = { activeCompetitionId: string | null; directoryPublished: boolean; contactName: string | null; contactTitle: string | null; contactQQ: string | null; contactEmail: string | null };
type Competition = { id: string; name: string; year: number | null; publicPublished: boolean; teamCount: number; publicTeamCount: number };
type Unit = { id: string; name: string; type: "COLLEGE" | "SHUYUAN" };
type Team = { id: string; name: string; teamType: "ORGANIZATION" | "JOINT" | "FREEFORM"; units: Array<{ id: string; name: string }>; publicStatus: string | null; publicContactName: string | null; publicContactRole: string | null; publicContactQQ: string | null; publicContactEmail: string | null; publicDirectoryNote: string | null; directoryIsPublic: boolean; directoryPublicOrder: number };
type AddMode = "organization" | "joint" | "custom" | "bulk";
const statuses = ["筹备中", "招募中", "已组队", "已确认参赛", "招募结束"];
const label = (c: Competition) => `${c.year && !c.name.includes(String(c.year)) ? `${c.year} ` : ""}${c.name}`;

async function api(url: string, method: "PATCH" | "POST", body: unknown) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string; result?: { createdNames?: string[] } };
  if (!response.ok) throw new Error(result.error ?? "操作失败。");
  return result;
}
function payload(team: Team, competitionId: string, changes: Partial<Team> = {}) {
  return { competitionId, publicStatus: team.publicStatus ?? "", publicContactName: team.publicContactName ?? "", publicContactRole: team.publicContactRole ?? "", publicContactQQ: team.publicContactQQ ?? "", publicContactEmail: team.publicContactEmail ?? "", publicDirectoryNote: team.publicDirectoryNote ?? "", directoryIsPublic: team.directoryIsPublic, directoryPublicOrder: team.directoryPublicOrder, ...changes };
}
function StatusField({ current }: { current: string | null }) {
  const [choice, setChoice] = useState(current && !statuses.includes(current) ? "custom" : current || "");
  return <div className={styles.statusField}><label><span>组队状态</span><select aria-label="组队状态" onChange={(event) => setChoice(event.target.value)} value={choice}><option value="">暂未设置</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}<option value="custom">自定义状态…</option></select></label>{choice === "custom" ? <label><span>自定义状态</span><input defaultValue={current && !statuses.includes(current) ? current : ""} maxLength={80} name="customStatus" required /></label> : null}<input name="statusChoice" type="hidden" value={choice} /></div>;
}

export function TeamDirectoryManager({ settings, competitions, units, selectedId, teams, canWrite }: { settings: Settings | null; competitions: Competition[]; units: Unit[]; selectedId: string | null; teams: Team[]; canWrite: boolean }) {
  const router = useRouter();
  const [chosenId, setChosenId] = useState(settings?.activeCompetitionId ?? "");
  const [publish, setPublish] = useState(settings?.directoryPublished ?? false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [details, setDetails] = useState(false);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [unitId, setUnitId] = useState("");
  const [designation, setDesignation] = useState("");
  const [newName, setNewName] = useState("");
  const [jointIds, setJointIds] = useState<string[]>([]);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState("recruiting");
  const [message, setMessage] = useState("");
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = competitions.find((c) => c.id === selectedId);
  const current = competitions.find((c) => c.id === settings?.activeCompetitionId);
  const displayed = Boolean(settings?.directoryPublished && current);
  const suggestion = addMode === "organization" ? `${units.find((u) => u.id === unitId)?.name ?? ""}${designation.trim()}` : addMode === "joint" ? `${jointIds.map((id) => units.find((u) => u.id === id)?.name).filter(Boolean).join("—")}联队` : "";
  const manageHref = selectedId ? `/admin/competitions/${encodeURIComponent(selectedId)}?section=teams` : "/admin/organizations?tab=teams";

  async function saveSettings(next: { activeCompetitionId: string | null; directoryPublished: boolean }, contact?: FormData) {
    setBusy(true); setMessage("");
    try {
      await api("/api/admin/team-directory", "PATCH", { ...next, contactName: contact ? String(contact.get("contactName") || "") : settings?.contactName ?? "", contactTitle: contact ? String(contact.get("contactTitle") || "") : settings?.contactTitle ?? "", contactQQ: contact ? String(contact.get("contactQQ") || "") : settings?.contactQQ ?? "", contactEmail: contact ? String(contact.get("contactEmail") || "") : settings?.contactEmail ?? "" });
      setMessage(next.directoryPublished ? "官网目录已更新。" : "已停止公开；球队和已保存信息均保留。"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); }
    finally { setBusy(false); }
  }
  async function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing || !selectedId) return;
    const f = new FormData(event.currentTarget);
    const choice = String(f.get("statusChoice") || "");
    const status = choice === "custom" ? String(f.get("customStatus") || "").trim() : choice;
    if (choice === "custom" && !status) { setRowError({ id: editing.id, text: "请输入自定义状态。" }); return; }
    setBusy(true); setRowError(null);
    try {
      await api(`/api/admin/team-directory/teams/${encodeURIComponent(editing.id)}`, "PATCH", payload(editing, selectedId, { publicStatus: status, publicContactName: String(f.get("publicContactName") || ""), publicContactRole: String(f.get("publicContactRole") || ""), publicContactQQ: String(f.get("publicContactQQ") || ""), publicContactEmail: String(f.get("publicContactEmail") || ""), publicDirectoryNote: String(f.get("publicDirectoryNote") || ""), directoryIsPublic: f.get("directoryIsPublic") === "on" }));
      setEditing(null); setMessage(`已保存“${editing.name}”。`); router.refresh();
    } catch (error) { setRowError({ id: editing.id, text: error instanceof Error ? error.message : "保存失败。" }); }
    finally { setBusy(false); }
  }
  async function toggleTeam(team: Team) {
    if (!selectedId) return; setBusy(true); setRowError(null);
    try { await api(`/api/admin/team-directory/teams/${encodeURIComponent(team.id)}`, "PATCH", payload(team, selectedId, { directoryIsPublic: !team.directoryIsPublic })); setMessage(`“${team.name}”已${team.directoryIsPublic ? "从官网隐藏" : "设为官网公开"}。`); router.refresh(); }
    catch (error) { setRowError({ id: team.id, text: error instanceof Error ? error.message : "操作失败。" }); }
    finally { setBusy(false); }
  }
  async function runBulk() {
    if (!selectedId || !checked.length) return; setBusy(true); setMessage("");
    try { await api("/api/admin/team-directory/teams", "PATCH", { competitionId: selectedId, teamIds: checked, action: bulkAction }); setMessage(`已更新 ${checked.length} 支球队。`); setChecked([]); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "批量操作失败。"); }
    finally { setBusy(false); }
  }
  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedId || !addMode) return; setBusy(true); setMessage("");
    try {
      const name = (newName || suggestion).trim();
      const body = addMode === "organization" ? { action: "organization", competitionId: selectedId, unitId, name } : addMode === "joint" ? { action: "joint", competitionId: selectedId, unitIds: jointIds, name } : addMode === "bulk" ? { action: "from-units", competitionId: selectedId, unitIds: bulkIds } : { action: "bulk", competitionId: selectedId, names: [name] };
      const result = await api("/api/referees/admin/teams", "POST", body);
      setMessage(addMode === "bulk" ? `已从组织库添加 ${result.result?.createdNames?.length ?? 0} 支球队；同名代表队已跳过。` : addMode === "custom" && result.result?.createdNames?.length === 0 ? `赛事中已存在球队“${name}”，没有重复创建。` : `球队“${name}”已创建，默认未在官网公开。`);
      setAddMode(null); setNewName(""); setDesignation(""); setUnitId(""); setJointIds([]); setBulkIds([]); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "球队创建失败。"); }
    finally { setBusy(false); }
  }
  function openAdd(mode: AddMode) { setAddMode(mode); setNewName(""); setUnitId(""); setDesignation(""); setJointIds([]); setBulkIds([]); setMessage(""); }
  function toggle(id: string, values: string[], setter: (next: string[]) => void) { setter(values.includes(id) ? values.filter((item) => item !== id) : [...values, id]); }

  return <div className={styles.root}>
    <nav aria-label="快捷操作" className={styles.quickActions}><Link className="admin-button" href="/admin/competitions/new">+ 新建赛事</Link><Link className="admin-button admin-button-secondary" href="/admin/competitions">管理赛事</Link><Link className="admin-button admin-button-secondary" href="/admin/matches">管理比赛</Link><Link className="admin-button admin-button-secondary" href={manageHref}>管理球队</Link></nav>
    <p aria-live="polite" className="admin-form-message">{message}</p>
    <section className="admin-panel"><header className="admin-panel-header"><div><h2>当前官网组队目录</h2><p>请选择球队信息页当前展示的赛事。同一时间仅展示 1 项赛事；赛事详情公开与组队目录独立。</p></div><span className="admin-status-badge" data-status={displayed ? "PUBLISHED" : "INACTIVE"}>{displayed ? "官网展示中" : "当前未公开"}</span></header><div className="admin-panel-body">
      <div className={styles.currentSummary}><span>官网当前展示</span><strong>{displayed && current ? label(current) : "当前暂无公开组队目录"}</strong><small>{displayed && current ? `${current.publicTeamCount} 支球队对外公开` : "公开页显示空状态；已保存资料不会删除。"}</small></div>
      <div aria-label="可选赛事" className={styles.competitionGrid} role="group">{competitions.map((c) => <label className={styles.competitionCard} data-selected={chosenId === c.id} key={c.id}><input checked={chosenId === c.id} disabled={!canWrite || busy} name="currentCompetition" onChange={() => setChosenId(c.id)} type="radio" value={c.id} /><span><strong>{label(c)}</strong><small>{displayed && current?.id === c.id ? "当前官网展示 · " : ""}{c.teamCount} 支赛事球队 · {c.publicTeamCount} 支官网公开</small><small>赛事详情：{c.publicPublished ? "已公开" : "未公开"}</small></span></label>)}</div>
      {!competitions.length ? <p>暂无可用赛事。请先新建赛事；测试赛事不会进入候选列表。</p> : null}
      {canWrite ? <div className={styles.actionFooter}><label className="admin-switch-row"><span><strong>公开所选赛事目录</strong><small>仅显示该赛事中已批准公开的球队。</small></span><input checked={publish} disabled={busy || !chosenId} onChange={(event) => setPublish(event.target.checked)} role="switch" type="checkbox" /><b>{publish ? "开启" : "关闭"}</b></label><div><button className="admin-button" disabled={busy || (publish && !chosenId)} onClick={() => void saveSettings({ activeCompetitionId: chosenId || null, directoryPublished: publish })} type="button">保存官网目录</button>{displayed ? <button className="admin-button admin-button-danger admin-button-danger-quiet" disabled={busy} onClick={() => { setPublish(false); void saveSettings({ activeCompetitionId: settings?.activeCompetitionId ?? null, directoryPublished: false }); }} type="button">停止公开当前目录</button> : null}</div></div> : null}</div></section>
    <section className="admin-panel"><header className="admin-panel-header"><div><h2>协会联系信息</h2><p>协会负责组队咨询的联系人，与下方各球队负责人分开维护。</p></div></header><div className="admin-panel-body"><form className="admin-form" onSubmit={(event) => { event.preventDefault(); void saveSettings({ activeCompetitionId: settings?.activeCompetitionId ?? null, directoryPublished: settings?.directoryPublished ?? false }, new FormData(event.currentTarget)); }}><div className="admin-form-grid"><label><span>球队信息负责人</span><input defaultValue={settings?.contactName ?? ""} disabled={!canWrite} maxLength={80} name="contactName" /></label><label><span>职务</span><input defaultValue={settings?.contactTitle ?? ""} disabled={!canWrite} maxLength={80} name="contactTitle" /></label><label><span>咨询 QQ</span><input defaultValue={settings?.contactQQ ?? ""} disabled={!canWrite} maxLength={40} name="contactQQ" /></label><label><span>联系邮箱</span><input defaultValue={settings?.contactEmail ?? ""} disabled={!canWrite} maxLength={254} name="contactEmail" type="email" /></label></div>{canWrite ? <footer className={styles.formFooter}><button className="admin-button" disabled={busy} type="submit">保存协会联系信息</button></footer> : null}</form></div></section>
    <section className="admin-panel"><header className="admin-panel-header"><div><h2>当前赛事球队目录</h2><p>{selected ? `${label(selected)} · ${teams.length} 支球队` : "请先选择赛事"}。球队名称来自正式 Team 记录；此处只维护对外公开信息。</p></div><span className="admin-status-badge" data-status={selectedId && displayed && selectedId === current?.id ? "PUBLISHED" : "UNSET"}>{selectedId && displayed && selectedId === current?.id ? "当前官网目录" : "仅编辑该赛事"}</span></header>
      <div className={`admin-panel-body ${styles.teamToolbar}`}><label className="admin-field-label" htmlFor="directory-editor-competition">编辑哪项赛事的球队 <select id="directory-editor-competition" onChange={(event) => { setEditing(null); setChecked([]); router.push(`/admin/team-directory?competition=${encodeURIComponent(event.target.value)}`); }} value={selectedId ?? ""}><option value="">请选择赛事</option>{competitions.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}</select></label><div className={styles.toolbarActions}><button className="admin-button admin-button-secondary" onClick={() => { router.refresh(); setMessage("已从正式赛事球队记录刷新列表；没有生成重复球队。"); }} type="button">同步当前赛事球队</button>{canWrite && selectedId ? <button className="admin-button" onClick={() => openAdd("organization")} type="button">+ 添加赛事球队</button> : null}</div></div>
      <div className={styles.sourceNote}>球队名称以正式 Team 为准。可从学院 / 书院创建代表队，也可创建同组织多队、联合队或自由组队；新球队默认不在官网公开。目录按学院编号自动排序，SQA项目位于学院末尾，书院球队随后。</div>
      {canWrite && selectedId && teams.length ? <div className={styles.bulkBar}><label><input aria-label="全选当前赛事球队" checked={checked.length === teams.length} onChange={(event) => setChecked(event.target.checked ? teams.map((team) => team.id) : [])} type="checkbox" /> 全选</label><span>已选 {checked.length} 支</span><select aria-label="批量操作" onChange={(event) => setBulkAction(event.target.value)} value={bulkAction}><option value="recruiting">批量设为招募中</option><option value="formed">批量设为已组队</option><option value="publish">批量公开</option><option value="hide">批量从官网隐藏</option></select><button className="admin-button admin-button-secondary" disabled={busy || !checked.length} onClick={() => void runBulk()} type="button">应用到所选球队</button></div> : null}
      {teams.length ? <div className={styles.teamList}><div className={styles.teamHead}><span>球队</span><span>组队状态</span><span>负责人 / 联系方式</span><span>官网状态</span><span>顺序</span><span>操作</span></div>{teams.map((team, index) => <div className={styles.teamRow} key={team.id}><div className={styles.teamPrimary}>{canWrite ? <input aria-label={`选择 ${team.name}`} checked={checked.includes(team.id)} onChange={() => toggle(team.id, checked, setChecked)} type="checkbox" /> : null}<div><strong>{team.name}</strong><small>{team.units.length ? `${team.teamType === "JOINT" ? "组成" : "所属"}：${team.units.map((u) => u.name).join("、")}` : "自由组队 · 无组织关联"}</small></div></div><div><span className="admin-status-badge" data-status={team.publicStatus === "招募中" ? "PENDING" : team.publicStatus ? "ACTIVE" : "UNSET"}>{team.publicStatus || "未设置"}</span></div><div className={styles.contactCell}><strong>{team.publicContactName || "未填写负责人"}</strong><small>{team.publicContactQQ ? `QQ ${team.publicContactQQ}` : ""}</small><small>{team.publicContactEmail || ""}</small></div><div><span className="admin-status-badge" data-status={team.directoryIsPublic ? "PUBLISHED" : "INACTIVE"}>{team.directoryIsPublic ? "已公开" : "未公开"}</span></div><div>{index + 1}</div><div className={styles.rowActions}>{canWrite ? <><button className="admin-button admin-button-secondary" onClick={() => { setEditing(team); setDetails(false); setRowError(null); }} type="button">编辑公开信息</button><button disabled={busy} onClick={() => void toggleTeam(team)} type="button">{team.directoryIsPublic ? "从官网隐藏" : "官网公开"}</button></> : null}<Link href={manageHref}>管理球队</Link></div>{rowError?.id === team.id ? <p aria-live="polite" className={styles.rowError}>{rowError.text}</p> : null}</div>)}</div> : <div className="admin-empty-state"><strong>{selected ? "该赛事尚无球队" : "尚未选择赛事"}</strong><p>从组织库添加代表队，或创建联合队、自由组队后即可维护公开信息。</p>{canWrite && selected ? <button className="admin-button" onClick={() => openAdd("organization")} type="button">添加赛事球队</button> : null}</div>}
    </section>
    {editing && selectedId ? <div aria-labelledby="directory-editor-title" aria-modal="true" className="admin-modal-backdrop" role="dialog"><div className={`admin-modal ${styles.editorModal}`}><header><div><span>TEAM PUBLIC INFORMATION</span><h2 id="directory-editor-title">编辑 {editing.name}</h2></div><button aria-label="关闭编辑" onClick={() => setEditing(null)} type="button">×</button></header><form className="admin-form" key={editing.id} onSubmit={submitTeam}><p className={styles.modalHelp}>仅填写负责人同意公开的联系方式。关闭“官网公开”会隐藏此球队，但保留球队和比赛。</p><div className="admin-form-grid"><StatusField current={editing.publicStatus} /><label><span>负责人姓名</span><input defaultValue={editing.publicContactName ?? ""} maxLength={80} name="publicContactName" /></label><label><span>公开 QQ</span><input defaultValue={editing.publicContactQQ ?? ""} maxLength={40} name="publicContactQQ" /></label><label><span>公开邮箱</span><input defaultValue={editing.publicContactEmail ?? ""} maxLength={254} name="publicContactEmail" type="email" /></label><label className="admin-switch-row"><span><strong>官网公开</strong><small>仅展示已人工确认可公开的信息。</small></span><input defaultChecked={editing.directoryIsPublic} name="directoryIsPublic" role="switch" type="checkbox" /><b>展示</b></label></div><button aria-expanded={details} className={styles.detailsToggle} onClick={() => setDetails(!details)} type="button">{details ? "收起详细信息" : "详细编辑负责人身份与公开说明"}</button><div className={styles.detailsOpen} hidden={!details}><label><span>负责人身份 / 备注</span><input defaultValue={editing.publicContactRole ?? ""} maxLength={80} name="publicContactRole" /></label><label><span>公开说明</span><textarea defaultValue={editing.publicDirectoryNote ?? ""} maxLength={1000} name="publicDirectoryNote" /></label></div>{rowError?.id === editing.id ? <p aria-live="polite" className={styles.rowError}>{rowError.text}</p> : null}<footer><button className="admin-button admin-button-secondary" onClick={() => setEditing(null)} type="button">取消</button><button className="admin-button" disabled={busy} type="submit">保存球队公开信息</button></footer></form></div></div> : null}
    {addMode && selectedId ? <div aria-labelledby="directory-add-title" aria-modal="true" className="admin-modal-backdrop" role="dialog"><div className={`admin-modal ${styles.editorModal}`}><header><div><span>CANONICAL TEAM</span><h2 id="directory-add-title">添加赛事球队</h2></div><button aria-label="关闭添加球队" onClick={() => setAddMode(null)} type="button">×</button></header><form className="admin-form" onSubmit={submitAdd}><p className={styles.modalHelp}>添加到 {selected ? label(selected) : "当前赛事"}。球队会成为正式参赛 Team，默认不在官网公开。</p><div aria-label="创建方式" className={styles.modeTabs} role="group"><button aria-pressed={addMode === "organization"} onClick={() => openAdd("organization")} type="button">从学院 / 书院添加</button><button aria-pressed={addMode === "joint"} onClick={() => openAdd("joint")} type="button">创建联合队</button><button aria-pressed={addMode === "custom"} onClick={() => openAdd("custom")} type="button">创建自定义球队</button><button aria-pressed={addMode === "bulk"} onClick={() => openAdd("bulk")} type="button">批量从组织库添加</button></div>
      {addMode === "organization" ? <><label><span>选择组织</span><select onChange={(event) => { setUnitId(event.target.value); setNewName(""); }} required value={unitId}><option value="">选择学院或书院</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.type === "COLLEGE" ? "学院" : "书院"}</option>)}</select></label><label><span>队别（可选）</span><input maxLength={30} onChange={(event) => setDesignation(event.target.value)} placeholder="如一队、二队、A队" value={designation} /></label></> : null}
      {addMode === "joint" || addMode === "bulk" ? <fieldset className={styles.unitChoices}><legend>选择{addMode === "joint" ? "至少两个组织" : "要添加的组织"}</legend>{units.map((u) => <label key={u.id}><input checked={(addMode === "joint" ? jointIds : bulkIds).includes(u.id)} onChange={() => { if (addMode === "joint") toggle(u.id, jointIds, setJointIds); else toggle(u.id, bulkIds, setBulkIds); }} type="checkbox" />{u.name}<small>{u.type === "COLLEGE" ? "学院" : "书院"}</small></label>)}</fieldset> : null}
      {addMode !== "bulk" ? <label><span>正式球队名称</span><input maxLength={80} onChange={(event) => setNewName(event.target.value)} placeholder={suggestion || "输入球队名称"} required={!suggestion} value={newName} /><small>建议名称：{suggestion || "请先选择组织"}。创建前可修改；此名称将成为正式 Team 名称。</small></label> : <p className={styles.modalHelp}>按组织正式名称批量创建代表队；同一赛事已有的同名代表队会跳过。同一组织仍可通过“队别”另建一队、二队。</p>}
      {message ? <p aria-live="polite" className={styles.rowError}>{message}</p> : null}<footer><button className="admin-button admin-button-secondary" onClick={() => setAddMode(null)} type="button">取消</button><button className="admin-button" disabled={busy || (addMode === "organization" && !unitId) || (addMode === "joint" && jointIds.length < 2) || (addMode === "bulk" && !bulkIds.length) || (addMode === "custom" && !newName.trim())} type="submit">{addMode === "bulk" ? "批量添加到当前赛事" : "创建赛事球队"}</button></footer></form></div></div> : null}
  </div>;
}
