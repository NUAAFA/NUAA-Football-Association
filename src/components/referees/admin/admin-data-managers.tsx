"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminAvailabilityCalendar } from "@/components/referees/admin/admin-availability-calendar";
import { conflictStatusLabels } from "@/components/referees/admin/admin-ui";
import { OrganizationCheckboxSelector } from "@/components/referees/admin/organization-checkbox-selector";
import { parsePastedTeamNames, parseTeamCsv } from "@/lib/referee-team-import";

async function api(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "操作失败。");
}

function useOperation() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function run(operation: () => Promise<void>, success = "操作已保存。") {
    setMessage("");
    try { await operation(); setMessage(success); router.refresh(); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败。"); return false; }
  }
  return { message, run };
}

function MissingCompetitionState() {
  return <div className="admin-empty-state">
    <strong>请先创建赛事后再创建参赛球队</strong>
    <p>赛事是球队与比赛的上级对象。</p>
    <Link className="admin-button" href="/admin/competitions/new">新建赛事</Link>
  </div>;
}

type AvailabilityRecord = { id: string; refereeId: string; kind: string; startAt: string; endAt: string; competitionFormat: string | null; note: string | null };
type AvailabilityRow = { id: string; referee: { id: string; name: string; publicCode: string }; recordCount: number; filledDays: number; availableDays: number; unavailableDays: number; availableRecords: number; unavailableRecords: number; updatedAt: string | null; dateRecords: AvailabilityRecord[] };
function timeLabel(value: string) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value)); }
function availabilityLabel(record: AvailabilityRecord) {
  const start = new Date(record.startAt), end = new Date(record.endAt);
  const allDay = timeLabel(record.startAt) === "00:00" && timeLabel(record.endAt) === "00:00" && end.getTime() - start.getTime() >= 86400000;
  return `${record.kind === "AVAILABLE" ? "可执裁" : "不可执裁"} · ${allDay ? "全天" : `${timeLabel(record.startAt)}–${timeLabel(record.endAt)}`}`;
}
export function AvailabilityManager({ items, referees, date }: {
  items: AvailabilityRow[];
  referees: Array<{ id: string; label: string }>;
  date: string;
  kind: "" | "AVAILABLE" | "UNAVAILABLE";
}) {
  const { message, run } = useOperation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AvailabilityRow | null>(null);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await run(() => api("/api/referees/admin/availability", "POST", {
      refereeId: form.get("refereeId"), startAt: form.get("startAt"), endAt: form.get("endAt"),
      kind: form.get("kind"), competitionType: form.get("competitionType"), note: form.get("note"),
    }), "可执裁时间已代录。");
    if (ok) setOpen(false);
  }
  return <>
    <p aria-live="polite" className="admin-form-message">{message}</p>
    <div className="admin-table-scroll"><table className="admin-data-table ops-availability-table">
      <thead><tr><th>裁判员</th>{date ? <th>当日可执裁情况</th> : <><th>已填写日期</th><th>可执裁</th><th>不可执裁</th><th>最近更新</th></>}<th>操作</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.referee.name}</strong><small>{item.referee.publicCode}</small></td>{date ? <td>{item.dateRecords.map((record) => <small key={record.id}>{availabilityLabel(record)}{record.note ? ` · ${record.note}` : ""}</small>)}</td> : <><td>{item.filledDays} 天<small>{item.recordCount} 条时间记录</small></td><td>{item.availableDays} 天</td><td>{item.unavailableDays} 天</td><td>{item.updatedAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(item.updatedAt)) : "—"}</td></>}<td><button type="button" onClick={() => setSelected(item)}>查看详情</button></td></tr>)}</tbody>
    </table></div>
    <button className="admin-floating-create" onClick={() => setOpen(true)} type="button">+ 代录时间</button>
    {selected ? <AdminAvailabilityCalendar key={selected.id} referee={selected.referee} initialDay={date} onClose={() => setSelected(null)} onDelete={(record) => run(() => api("/api/referees/admin/availability", "DELETE", { id: record.id, refereeId: record.refereeId }), "记录已删除。")} /> : null}
    {open ? <div aria-modal="true" className="admin-modal-backdrop" role="dialog"><div className="admin-modal">
      <header><div><span>AVAILABILITY</span><h2>管理员代录可执裁时间</h2></div><button aria-label="关闭" onClick={() => setOpen(false)} type="button">×</button></header>
      <form className="admin-form" onSubmit={create}><div className="admin-form-grid">
        <label><span>裁判员</span><select name="refereeId" required>{referees.map((referee) => <option key={referee.id} value={referee.id}>{referee.label}</option>)}</select></label>
        <label><span>类型</span><select name="kind"><option value="AVAILABLE">可执裁</option><option value="UNAVAILABLE">不可执裁</option></select></label>
        <label><span>比赛制式</span><select name="competitionType"><option value="BOTH">均可</option><option value="ELEVEN_A_SIDE">十一人制</option><option value="FUTSAL">五人制</option></select></label>
        <label><span>开始</span><input name="startAt" required type="datetime-local" /></label><label><span>结束</span><input name="endAt" required type="datetime-local" /></label>
      </div><label><span>说明</span><input maxLength={240} name="note" /></label><footer><button className="admin-button admin-button-secondary" onClick={() => setOpen(false)} type="button">取消</button><button className="admin-button" type="submit">保存记录</button></footer></form>
    </div></div> : null}
  </>;
}

type AffiliationUnitRow = { id: string; name: string; label: string; type: "COLLEGE" | "SHUYUAN"; childIds: string[]; mappings: Array<{ id: string; prefix: string; note: string }> };
type TeamRow = { id: string; name: string; competitionId: string; competition: string; teamType: "ORGANIZATION" | "JOINT" | "FREEFORM"; unitIds: string[] };
type OrganizationModal = "college" | "house-create" | "house-edit" | "house-relations" | "house-delete" | "mapping" | "bulk" | "from-units" | "joint";

const modalTitles: Record<OrganizationModal, string> = {
  college: "新增学院", "house-create": "新增书院", "house-edit": "编辑书院", "house-relations": "编辑组成关系",
  "house-delete": "删除书院", mapping: "保存学号前缀映射", bulk: "批量导入自由组队", "from-units": "从组织单位创建代表队", joint: "新建联合队",
};

export function AffiliationsManager({ units, teams, competitions, initialTab = "colleges", initialCompetitionId = "" }: {
  units: AffiliationUnitRow[];
  teams: TeamRow[];
  competitions: Array<{ id: string; name: string }>;
  initialTab?: "colleges" | "shuyuan" | "mappings" | "relations" | "teams";
  initialCompetitionId?: string;
}) {
  const { message, run } = useOperation();
  const [tab, setTab] = useState<"colleges" | "shuyuan" | "mappings" | "relations" | "teams">(initialTab);
  const [modal, setModal] = useState<OrganizationModal | null>(null);
  const [activeHouse, setActiveHouse] = useState<AffiliationUnitRow | null>(null);
  const [houseName, setHouseName] = useState("");
  const [houseSelection, setHouseSelection] = useState<string[]>([]);
  const [modalUnitIds, setModalUnitIds] = useState<string[]>([]);
  const [teamSelections, setTeamSelections] = useState<Record<string, string[]>>(() => Object.fromEntries(teams.map((team) => [team.id, team.unitIds])));
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<"paste" | "csv">("paste");
  const [importCompetitionId, setImportCompetitionId] = useState(competitions.some((item) => item.id === initialCompetitionId) ? initialCompetitionId : competitions[0]?.id ?? "");
  const colleges = units.filter((unit) => unit.type === "COLLEGE");
  const shuyuan = units.filter((unit) => unit.type === "SHUYUAN");
  const collegeOptions = colleges.map((college) => ({ id: college.id, label: college.label, description: "学院" }));
  const unitOptions = units.map((unit) => ({ id: unit.id, label: unit.label, description: unit.type === "COLLEGE" ? "学院" : "书院" }));
  const preview = importFormat === "csv"
    ? parseTeamCsv(importText, teams.filter((team) => team.competitionId === importCompetitionId).map((team) => team.name))
    : parsePastedTeamNames(importText, teams.filter((team) => team.competitionId === importCompetitionId).map((team) => team.name));

  function openHouseEditor(nextModal: Extract<OrganizationModal, "house-create" | "house-edit" | "house-relations" | "house-delete">, house: AffiliationUnitRow | null = null) {
    setActiveHouse(house); setHouseName(house?.name ?? ""); setHouseSelection(house?.childIds ?? []); setModal(nextModal);
  }
  function memberNames(unit: AffiliationUnitRow) {
    return unit.childIds.map((id) => colleges.find((college) => college.id === id)?.name).filter((name): name is string => Boolean(name));
  }
  async function createCollege(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await run(() => api("/api/referees/admin/affiliation-units", "POST", { action: "create", name: form.get("name"), type: "COLLEGE", childUnitIds: [] }), "学院已创建。");
    if (ok) setModal(null);
  }
  async function saveHouse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isCreate = modal === "house-create";
    const ok = await run(() => isCreate
      ? api("/api/referees/admin/affiliation-units", "POST", { action: "create", name: houseName, type: "SHUYUAN", childUnitIds: houseSelection })
      : modal === "house-edit" && activeHouse
        ? api("/api/referees/admin/affiliation-units", "PATCH", { id: activeHouse.id, name: houseName })
        : activeHouse
          ? api("/api/referees/admin/affiliation-units", "POST", { action: "set-children", parentUnitId: activeHouse.id, childUnitIds: houseSelection })
          : Promise.reject(new Error("未选择书院。")), isCreate ? "书院已创建。" : modal === "house-edit" ? "书院资料已更新。" : "书院组成关系已更新。");
    if (ok) setModal(null);
  }
  async function deleteHouse() {
    if (!activeHouse) return;
    const ok = await run(() => api("/api/referees/admin/affiliation-units", "DELETE", { id: activeHouse.id, confirmationName: activeHouse.name }), `书院“${activeHouse.name}”已删除。`);
    if (ok) setModal(null);
  }
  async function createMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await run(() => api("/api/referees/admin/colleges", "POST", { action: "upsert-mapping", prefix: form.get("prefix"), collegeId: form.get("collegeId"), note: form.get("note") }), "学号前缀映射已保存。");
    if (ok) setModal(null);
  }
  async function confirmBulk() {
    const ok = await run(() => api("/api/referees/admin/teams", "POST", { action: "bulk", competitionId: importCompetitionId, names: preview.names }), `已创建 ${preview.names.length} 支自由组队球队。`);
    if (ok) { setModal(null); setImportText(""); }
  }
  async function fromUnits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await run(() => api("/api/referees/admin/teams", "POST", { action: "from-units", competitionId: form.get("competitionId"), unitIds: modalUnitIds }), "组织代表队已批量创建。");
    if (ok) setModal(null);
  }
  async function jointTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const ok = await run(() => api("/api/referees/admin/teams", "POST", { action: "joint", competitionId: form.get("competitionId"), name: form.get("name"), unitIds: modalUnitIds }), "联合队已创建。");
    if (ok) setModal(null);
  }
  async function saveTeam(event: React.FormEvent<HTMLFormElement>, team: TeamRow) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await run(() => api("/api/referees/admin/team-affiliations", "PUT", { teamId: team.id, teamType: form.get("teamType"), unitIds: teamSelections[team.id] ?? team.unitIds }), "球队组织关联已保存。");
  }

  return <>
    <nav aria-label="组织管理分区" className="admin-tabs" role="tablist">
      <button aria-selected={tab === "colleges"} onClick={() => setTab("colleges")} role="tab" type="button">学院 <span>{colleges.length}</span></button>
      <button aria-selected={tab === "shuyuan"} onClick={() => setTab("shuyuan")} role="tab" type="button">书院 <span>{shuyuan.length}</span></button>
      <button aria-selected={tab === "mappings"} onClick={() => setTab("mappings")} role="tab" type="button">学号前缀映射</button>
      <button aria-selected={tab === "relations"} onClick={() => setTab("relations")} role="tab" type="button">组织关系</button>
      <button aria-selected={tab === "teams"} onClick={() => setTab("teams")} role="tab" type="button">球队关联 <span>{teams.length}</span></button>
    </nav>
    <p aria-live="polite" className="admin-form-message">{message}</p>
    {tab === "colleges" ? <section className="admin-panel"><header className="admin-panel-header"><div><h2>学院</h2><p>标准化学院组织单位，按已确认学号前缀排序，不包含书院。</p></div><button className="admin-button" onClick={() => setModal("college")} type="button">+ 新增学院</button></header><div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>学院名称</th><th>代码映射数</th><th>关联球队数</th></tr></thead><tbody>{colleges.map((college) => <tr key={college.id}><td><strong>{college.label}</strong></td><td>{college.mappings.length}</td><td>{teams.filter((team) => team.unitIds.includes(college.id)).length}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "shuyuan" ? <section className="admin-panel"><header className="admin-panel-header"><div><h2>书院</h2><p>书院由数据记录驱动，可维护名称与组成学院；删除不会影响学院实体。</p></div><button className="admin-button" onClick={() => openHouseEditor("house-create")} type="button">+ 新增书院</button></header>{shuyuan.length ? <div className="admin-house-grid">{shuyuan.map((unit) => { const names = memberNames(unit); const teamCount = teams.filter((team) => team.unitIds.includes(unit.id)).length; return <article className="admin-house-card" key={unit.id}><header><div><h3>{unit.name}</h3><span>{names.length} 个组成学院</span></div><span className="admin-status-badge">{teamCount ? `${teamCount} 支关联球队` : "暂无球队引用"}</span></header>{names.length ? <ul>{names.map((name) => <li key={name}>{name}</li>)}</ul> : <div className="admin-empty-state admin-empty-state-compact"><strong>尚未设置组成学院</strong><p>可通过“编辑组成关系”选择学院。</p></div>}<footer><button className="admin-button admin-button-secondary" onClick={() => openHouseEditor("house-relations", unit)} type="button">编辑组成关系</button><button className="admin-button admin-button-secondary" onClick={() => openHouseEditor("house-edit", unit)} type="button">编辑书院</button><button className="admin-button admin-button-danger admin-button-danger-quiet" onClick={() => openHouseEditor("house-delete", unit)} type="button">删除书院</button></footer></article>; })}</div> : <div className="admin-empty-state"><strong>当前尚无书院</strong><p>新增书院后，可继续设置组成学院与球队关联。</p><button className="admin-button" onClick={() => openHouseEditor("house-create")} type="button">新增书院</button></div>}</section> : null}
    {tab === "mappings" ? <section className="admin-panel"><header className="admin-panel-header"><div><h2>学号代码映射</h2><p>学号前两位仅提供学院建议，最终以裁判员档案为准。</p></div><button className="admin-button" onClick={() => setModal("mapping")} type="button">+ 保存映射</button></header><div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>前缀</th><th>建议学院</th><th>说明</th></tr></thead><tbody>{colleges.flatMap((college) => college.mappings.map((mapping) => <tr key={mapping.id}><td><strong>{mapping.prefix}</strong></td><td>{college.name}</td><td>{mapping.note || "—"}</td></tr>))}</tbody></table></div></section> : null}
    {tab === "relations" ? <section className="admin-panel"><header className="admin-panel-header"><div><h2>书院组成关系</h2><p>只记录管理员确认的组成学院，不由系统推断个人书院归属。</p></div></header>{shuyuan.length ? <div className="admin-relation-list">{shuyuan.map((unit) => <article key={unit.id}><div><strong>{unit.name}</strong><span>{unit.childIds.length ? `${unit.childIds.length} 个组成学院` : "组成关系待补充"}</span></div><p>{memberNames(unit).join("、") || "尚未选择学院"}</p><button className="admin-button admin-button-secondary" onClick={() => openHouseEditor("house-relations", unit)} type="button">编辑组成关系</button></article>)}</div> : <div className="admin-empty-state"><strong>暂无可维护的书院关系</strong><p>请先在“书院”分区新增书院。</p></div>}</section> : null}
    {tab === "teams" ? <section className="admin-panel"><header className="admin-panel-header"><div><h2>参赛球队与组织关联</h2><p>管理参赛球队与学院、书院之间的关系，用于裁判选派时识别组织关联。</p></div><div className="admin-page-actions"><button className="admin-button admin-button-secondary" onClick={() => { setModalUnitIds([]); setModal("from-units"); }} type="button">从组织创建</button><button className="admin-button admin-button-secondary" onClick={() => { setModalUnitIds([]); setModal("joint"); }} type="button">+ 联合队</button><button className="admin-button" onClick={() => setModal("bulk")} type="button">批量导入球队</button></div></header>{!competitions.length ? <MissingCompetitionState /> : teams.length ? <div className="admin-team-affiliation-list">{teams.map((team) => <form className="admin-team-affiliation-card" key={team.id} onSubmit={(event) => void saveTeam(event, team)}><header><div><strong>{team.name}</strong><span>{team.competition}</span></div><label><span>球队类型</span><select defaultValue={team.teamType} name="teamType"><option value="ORGANIZATION">固定组织代表队</option><option value="JOINT">联合队</option><option value="FREEFORM">自由组队</option></select></label></header><OrganizationCheckboxSelector legend="关联组织单位" onChange={(values) => setTeamSelections((current) => ({ ...current, [team.id]: values }))} options={unitOptions} selectedValues={teamSelections[team.id] ?? team.unitIds} /><footer><button className="admin-button admin-button-secondary" type="submit">保存球队关联</button></footer></form>)}</div> : <div className="admin-empty-state"><strong>当前没有参赛球队</strong><p>可从组织创建代表队、建立联合队或批量导入球队。</p></div>}</section> : null}
    {modal ? <div aria-modal="true" className="admin-modal-backdrop" role="dialog"><div className="admin-modal"><header><div><span>ORGANIZATION & TEAMS</span><h2>{modalTitles[modal]}</h2></div><button aria-label="关闭" onClick={() => setModal(null)} type="button">×</button></header>
      {modal === "college" ? <form className="admin-form" onSubmit={createCollege}><label><span>学院名称</span><input maxLength={80} name="name" required /></label><footer><button className="admin-button admin-button-secondary" onClick={() => setModal(null)} type="button">取消</button><button className="admin-button" type="submit">创建学院</button></footer></form> : null}
      {modal === "house-create" || modal === "house-edit" || modal === "house-relations" ? <form className="admin-form" onSubmit={saveHouse}>{modal !== "house-relations" ? <label><span>书院名称</span><input maxLength={80} onChange={(event) => setHouseName(event.target.value)} required value={houseName} /></label> : <div className="admin-form-readonly"><div><span>书院</span><strong>{activeHouse?.name}</strong></div></div>}{modal !== "house-edit" ? <OrganizationCheckboxSelector legend="组成学院" onChange={setHouseSelection} options={collegeOptions} searchPlaceholder="搜索学院…" selectedValues={houseSelection} /> : null}{message ? <p aria-live="polite" className="admin-form-message">{message}</p> : null}<footer><button className="admin-button admin-button-secondary" onClick={() => setModal(null)} type="button">取消</button><button className="admin-button" type="submit">{modal === "house-create" ? "创建书院" : "保存修改"}</button></footer></form> : null}
      {modal === "house-delete" && activeHouse ? <div className="admin-form"><p>确认删除书院“<strong>{activeHouse.name}</strong>”？</p><div className="admin-danger-notice"><strong>不会删除组成学院</strong><p>若书院已有关联裁判员、球队或其他受保护引用，服务端会拒绝删除并保留历史。</p></div>{message ? <p aria-live="polite" className="admin-danger-message">{message}</p> : null}<footer><button className="admin-button admin-button-secondary" onClick={() => setModal(null)} type="button">取消</button><button className="admin-button admin-button-danger" onClick={() => void deleteHouse()} type="button">确认删除书院</button></footer></div> : null}
      {modal === "mapping" ? <form className="admin-form" onSubmit={createMapping}><label><span>两位学号前缀</span><input autoCapitalize="characters" maxLength={2} minLength={2} name="prefix" placeholder="01 / CG" required /></label><label><span>建议学院</span><select name="collegeId" required>{colleges.map((college) => <option key={college.id} value={college.id}>{college.label}</option>)}</select></label><label><span>说明</span><input name="note" /></label><footer><button className="admin-button admin-button-secondary" onClick={() => setModal(null)} type="button">取消</button><button className="admin-button" type="submit">保存映射</button></footer></form> : null}
      {modal === "bulk" ? competitions.length ? <div className="admin-form"><div className="admin-form-grid"><label><span>赛事</span><select onChange={(event) => setImportCompetitionId(event.target.value)} value={importCompetitionId}>{competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label><label><span>导入方式</span><select onChange={(event) => setImportFormat(event.target.value as "paste" | "csv")} value={importFormat}><option value="paste">粘贴球队名单</option><option value="csv">CSV 文件 / 文本</option></select></label></div>{importFormat === "csv" ? <label><span>选择 CSV</span><input accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setImportText); }} type="file" /></label> : null}<label><span>{importFormat === "csv" ? "CSV 内容（须含 name 或 球队名称列）" : "每行一支球队"}</span><textarea onChange={(event) => setImportText(event.target.value)} placeholder={importFormat === "csv" ? "球队名称\n丁丁历险记\n海底小纵队" : "丁丁历险记\n海底小纵队\nBGV"} rows={10} value={importText} /></label><div className="admin-import-preview"><strong>导入预览：可创建 {preview.names.length} 支</strong>{preview.duplicates.length ? <p>已去除重复：{preview.duplicates.join("、")}</p> : null}{preview.existing.length ? <p>赛事中已存在：{preview.existing.join("、")}</p> : null}{preview.errors.map((error) => <p className="admin-import-error" key={error}>{error}</p>)}{preview.names.length ? <ol>{preview.names.map((name) => <li key={name}>{name}</li>)}</ol> : <p>输入名单后在此确认。</p>}</div><footer><button className="admin-button admin-button-secondary" onClick={() => setModal(null)} type="button">取消</button><button className="admin-button" disabled={!preview.names.length || preview.errors.length > 0} onClick={() => void confirmBulk()} type="button">确认批量创建</button></footer></div> : <MissingCompetitionState /> : null}
      {modal === "from-units" ? competitions.length ? <form className="admin-form" onSubmit={fromUnits}><label><span>赛事</span><select name="competitionId" required>{competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label><OrganizationCheckboxSelector legend="组织单位" onChange={setModalUnitIds} options={unitOptions} selectedValues={modalUnitIds} /><footer><button className="admin-button admin-button-secondary" onClick={() => setModal(null)} type="button">取消</button><button className="admin-button" disabled={!modalUnitIds.length} type="submit">批量创建代表队</button></footer></form> : <MissingCompetitionState /> : null}
      {modal === "joint" ? competitions.length ? <form className="admin-form" onSubmit={jointTeam}><label><span>赛事</span><select name="competitionId" required>{competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label><label><span>联合队名称</span><input maxLength={80} name="name" required /></label><OrganizationCheckboxSelector legend="关联组织单位（至少两个）" onChange={setModalUnitIds} options={unitOptions} selectedValues={modalUnitIds} /><footer><button className="admin-button admin-button-secondary" onClick={() => setModal(null)} type="button">取消</button><button className="admin-button" disabled={modalUnitIds.length < 2} type="submit">创建联合队</button></footer></form> : <MissingCompetitionState /> : null}
    </div></div> : null}
  </>;
}

export function ConflictReportsManager({ reports }: {
  reports: Array<{ id: string; referee: string; competition: string; matchId: string; match: string; kickoff: string; venue: string; position: string; reason: string; reasonCode: string; explanation: string; reportedAt: string; status: string; resolutionNote: string }>;
}) {
  const { message, run } = useOperation();
  const [active, setActive] = useState<(typeof reports)[number] | null>(null);
  async function resolve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!active) return; const form = new FormData(event.currentTarget);
    const ok = await run(() => api(`/api/referees/admin/conflict-reports/${active.id}`, "PATCH", { status: form.get("status"), resolutionNote: form.get("resolutionNote") }), "冲突报告已处理。");
    if (ok) setActive(null);
  }
  const reasonLabels: Record<string, string> = { TIME_CONFLICT: "时间冲突", UNABLE_TO_ATTEND: "临时无法到场", COURSE_EXAM: "课程/考试", HEALTH: "身体原因", OTHER: "其他" };
  return <><p aria-live="polite" className="admin-form-message">{message}</p><div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>裁判员</th><th>赛事 / 比赛</th><th>时间 / 场地</th><th>岗位</th><th>原因</th><th>报告时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td><strong>{report.referee}</strong></td><td><strong>{report.competition}</strong><small>{report.match}</small></td><td>{report.kickoff}<small>{report.venue}</small></td><td>{report.position || "—"}</td><td><strong>{reasonLabels[report.reasonCode] ?? report.reasonCode}</strong><small>{report.explanation}</small></td><td>{report.reportedAt}</td><td><span className="admin-status-badge" data-status={report.status}>{conflictStatusLabels[report.status] ?? report.status}</span></td><td><div className="admin-table-actions"><button onClick={() => setActive(report)} type="button">{report.status === "PENDING" ? "处理" : "查看"}</button><Link href={`/admin/appointments/${report.matchId}`}>更换裁判</Link></div></td></tr>)}</tbody></table></div>{active ? <div aria-modal="true" className="admin-modal-backdrop" role="dialog"><div className="admin-modal admin-modal-compact"><header><div><span>CONFLICT REPORT</span><h2>冲突报告详情</h2></div><button aria-label="关闭" onClick={() => setActive(null)} type="button">×</button></header><form className="admin-form" onSubmit={resolve}><div className="admin-report-summary"><strong>{active.referee}</strong><span>{active.competition} · {active.match} · {active.position || "岗位未识别"}</span><span>{active.kickoff} · {active.venue}</span><p><b>{reasonLabels[active.reasonCode] ?? active.reasonCode}</b>：{active.explanation}</p></div><Link className="admin-button admin-button-secondary" href={`/admin/appointments/${active.matchId}`}>打开本场选派 / 更换裁判</Link>{active.status === "PENDING" ? <><label><span>处理结果</span><select name="status"><option value="RESOLVED">保留当前处理结果并关闭</option><option value="DISMISSED">驳回报告</option></select></label><label><span>处理说明</span><textarea maxLength={500} name="resolutionNote" required /></label><footer><button className="admin-button admin-button-secondary" onClick={() => setActive(null)} type="button">取消</button><button className="admin-button" type="submit">保存处理结果</button></footer></> : <div className="admin-report-resolution"><span>处理说明</span><p>{active.resolutionNote || "—"}</p></div>}</form></div></div> : null}</>;
}
