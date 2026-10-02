"use client";
import { TeamGroupingManager, type GroupingStage } from "@/components/admin/team-grouping-manager";

import Link from "next/link";
import { WorkspaceDialog } from "@/components/admin/workspace-dialog";
import { formatBeijingDateTime } from "@/lib/beijing-datetime";
import { useEffect, useState } from "react";

import {
  buildCompetitionImportErrorCsv,
  COMPETITION_IMPORT_MAX_FILE_BYTES,
  type CompetitionImportCommitResult,
  type CompetitionImportInputMethod,
  type CompetitionImportPreview,
  type CompetitionImportType,
} from "@/lib/competition-import-types";

type CompetitionOption = { id: string; name: string; year: number | null };

const actionLabels = {
  CREATE: "创建",
  REUSE_EXISTING: "复用已有",
  SKIP_DUPLICATE: "跳过重复",
  CONFLICT: "冲突",
  ERROR: "错误",
} as const;

const summaryItems: Array<{ key: keyof CompetitionImportPreview["summary"]; label: string }> = [
  { key: "totalRows", label: "总行数" },
  { key: "validRows", label: "有效行" },
  { key: "createRows", label: "创建" },
  { key: "reuseRows", label: "复用" },
  { key: "skipRows", label: "跳过" },
  { key: "warningRows", label: "警告" },
  { key: "conflictRows", label: "冲突" },
  { key: "errorRows", label: "错误" },
];

export function CompetitionImportManager({ competitions, initialCompetitionId, initialType = "TEAM" }: { competitions: CompetitionOption[]; initialCompetitionId?: string; initialType?: CompetitionImportType }) {
  const [competitionId, setCompetitionId] = useState(initialCompetitionId && competitions.some((c) => c.id === initialCompetitionId) ? initialCompetitionId : competitions[0]?.id ?? "");
  const [importType, setImportType] = useState<CompetitionImportType>(initialType);
  const [inputMethod, setInputMethod] = useState<CompetitionImportInputMethod>("CSV");
  const [content, setContent] = useState("");
  const [teamMappings, setTeamMappings] = useState<Record<string,string>>({}), [groupMappings, setGroupMappings] = useState<Record<string,string>>({}), [excluded, setExcluded] = useState<number[]>([]);
  const [mappingSearch, setMappingSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CompetitionImportPreview | null>(null);
  const [result, setResult] = useState<CompetitionImportCommitResult | null>(null);
  const [message, setMessage] = useState("");
  const [docxEdits, setDocxEdits] = useState<Record<string, Record<string, string>>>({});
  const [docxDirty, setDocxDirty] = useState(false);
  const [groupOptions, setGroupOptions] = useState<Array<{ id: string; name: string; stageId: string; rounds: Array<{ id: string; name: string }> }>>([]);
  const [grouping, setGrouping] = useState<{ stages: GroupingStage[]; teams: { id: string; name: string }[] } | null>(null);
  const [structureVersion, setStructureVersion] = useState(0);
  async function openGrouping() {
    try { const response = await fetch(`/api/admin/competitions/${competitionId}/structure`); const data = await response.json(); if (!response.ok) throw new Error(data.error || "分组读取失败"); setGrouping(data); } catch (error) { setMessage(error instanceof Error ? error.message : "分组读取失败"); }
  }
  const [bulkDate, setBulkDate] = useState(""), [bulkTime, setBulkTime] = useState(""), [bulkVenue, setBulkVenue] = useState("");
  useEffect(() => {
    if (importType !== "MATCH" || !competitionId) return;
    const controller = new AbortController();
    fetch(`/api/admin/competitions/${competitionId}/structure`, { signal: controller.signal }).then((r) => r.json()).then((d) => {
      if (!controller.signal.aborted && Array.isArray(d.stages)) setGroupOptions(d.stages.filter((stage: { type: string }) => stage.type === "GROUP").flatMap((stage: { id: string; groups: Array<{ id: string; name: string }>; rounds: Array<{ id: string; name: string; groupId: string | null }> }) => stage.groups.map((group) => ({ id: group.id, name: group.name, stageId: stage.id, rounds: stage.rounds.filter((round) => !round.groupId || round.groupId === group.id).map((round) => ({ id: round.id, name: round.name })) }))));
    }).catch(() => {});
    return () => controller.abort();
  }, [competitionId, importType, structureVersion]);
  const [busy, setBusy] = useState(false);
  const [columns, setColumns] = useState<string[]>([]), [samples, setSamples] = useState<string[][]>([]), [mapping, setMapping] = useState<Record<string, string>>({}), [previewPage, setPreviewPage] = useState(1);

  function resetAnalysis() {
    setPreview(null);
    setResult(null);
    setMessage("");
    setDocxEdits({}); setDocxDirty(false); setTeamMappings({}); setGroupMappings({}); setExcluded([]);
  }

  function editDocx(rowNumber: number, field: string, value: string) {
    setDocxEdits((old) => ({ ...old, [rowNumber]: { ...(old[rowNumber] ?? {}), [field]: value } }));
    setDocxDirty(true); setResult(null);
  }

  function formData() {
    if (!competitionId) throw new Error("请先选择赛事。");
    const form = new FormData();
    form.set("competitionId", competitionId);
    form.set("importType", importType);
    form.set("inputMethod", inputMethod);
    form.set("columnMapping", JSON.stringify(mapping));
    form.set("docxEdits", JSON.stringify(docxEdits));
    form.set("teamMappings", JSON.stringify(teamMappings)); form.set("groupMappings", JSON.stringify(groupMappings)); form.set("excludedRowNumbers", JSON.stringify(excluded));
    if (preview) form.set("planHash", preview.planHash);
    if (inputMethod === "PASTE") {
      if (!content.trim()) throw new Error("请粘贴待导入内容。");
      form.set("content", content);
    } else {
      if (!file) throw new Error("请选择导入文件。");
      if (file.size > COMPETITION_IMPORT_MAX_FILE_BYTES) throw new Error("导入文件不能超过 5 MB。");
      form.set("file", file);
    }
    return form;
  }

  async function inspectColumns() {
    setBusy(true); setMessage("");
    try { const form = formData(); form.set("inspect", "true"); const r = await fetch("/api/admin/competitions/import/columns", { method: "POST", body: form }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "读取失败。"); setColumns(d.columns); setSamples(d.samples); }
    catch (e) { setMessage(e instanceof Error ? e.message : "读取失败。"); } finally { setBusy(false); }
  }
  async function request(path: "preview" | "commit") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/competitions/import/${path}`, {
        method: "POST",
        body: formData(),
      });
      const body = await response.json() as {
        error?: string;
        preview?: CompetitionImportPreview;
        result?: CompetitionImportCommitResult;
      };
      if (body.preview) setPreview(body.preview);
      if (!response.ok) throw new Error(body.error ?? "导入请求失败。");
      if (path === "preview" && body.preview) {
        setPreview(body.preview);
        setDocxDirty(false);
        setPreviewPage(1);
        setResult(null);
        setMessage("检查完成，未产生业务写入。请核对时间、分组及公开影响。");
      }
      if (path === "commit" && body.result) {
        setResult(body.result);
        setPreview(body.result.preview);
        setMessage("导入完成。裁判报名保持关闭；公开赛程已更新。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入请求失败。");
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    if (!preview) return;
    const blob = new Blob([buildCompetitionImportErrorCsv(preview)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nuaafa-import-errors-${preview.inputHash.slice(0, 12)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const commitBlocked = docxDirty || !preview || !preview.rows.length || preview.summary.errorRows > 0 || preview.summary.conflictRows > 0;
  const pastePlaceholder = importType === "TEAM"
    ? "name\tteamType\n计算机学院\tORGANIZATION\n自由组队A\tFREEFORM"
    : "主队\t客队\t开球时间\t结束时间\t场地\t阶段\t分组\t轮次\n计算机学院\t电子信息工程学院\t2026-10-15 18:30\t\t天目湖校区足球场\t小组赛\tA组\t第1轮";

  return <div className="admin-import-workflow">
    <section className="admin-panel">
      <header className="admin-panel-header"><div><h2>上传文件 · 选择赛事</h2><p>先选赛事，再选择球队或赛程。</p></div></header>
      <div className="admin-panel-body admin-form-grid">
        <label><span>赛事</span><select value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); resetAnalysis(); }}>
          {competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}{competition.year ? ` · ${competition.year}` : ""}</option>)}
        </select></label>
        <label><span>导入内容</span><select value={importType} onChange={(event) => { setImportType(event.target.value as CompetitionImportType); setInputMethod("CSV"); setFile(null); setContent(""); setColumns([]); setSamples([]); setMapping({}); resetAnalysis(); }}>
          <option value="TEAM">球队导入</option><option value="MATCH">赛程 / 比赛导入</option>
        </select></label>
      </div>
    </section>

    <section className="admin-panel">
      <header className="admin-panel-header"><div><h2>1. 上传文件</h2><p>文件支持 CSV、XLSX 和已核验的足球中国 DOCX 赛程；粘贴支持逗号或制表符分隔，读取首个工作表。上限 5 MB / 5000 行。</p></div><div className="admin-page-actions"><a className="admin-button admin-button-secondary" href={`/api/admin/competitions/import/templates/${importType === "TEAM" ? "team" : "match"}`}>下载当前 CSV 模板</a></div></header>
      <div className="admin-panel-body admin-form">
        <div className="admin-import-methods" role="radiogroup" aria-label="输入方式">
          {(["CSV", "XLSX", "PASTE", ...(importType === "MATCH" ? ["DOCX" as const] : [])] as const).map((method) => <button aria-checked={inputMethod === method} className={inputMethod === method ? "is-active" : ""} key={method} onClick={() => { setInputMethod(method); setFile(null); setContent(""); setColumns([]); setSamples([]); setMapping({}); resetAnalysis(); }} role="radio" type="button">{method === "PASTE" ? "批量粘贴" : method}</button>)}
        </div>
        {inputMethod === "PASTE" ? <label><span>TSV / Excel 粘贴内容（也可识别明确 CSV；球队可每行一个名称）</span><textarea onChange={(event) => { setContent(event.target.value); setColumns([]); setSamples([]); setMapping({}); resetAnalysis(); }} placeholder={pastePlaceholder} rows={10} value={content} /></label> : <label><span>选择 {inputMethod === "CSV" ? "UTF-8 CSV" : inputMethod === "DOCX" ? "Word .docx" : "Excel .xlsx"} 文件</span><input accept={inputMethod === "CSV" ? ".csv,text/csv" : inputMethod === "DOCX" ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setColumns([]); setSamples([]); setMapping({}); resetAnalysis(); }} type="file" /></label>}
        <p className="admin-import-safety-note">导入记录人工确认的赛程，缺少时间或场地的新比赛为“待排期”；资料完整后为“已安排”，裁判报名默认关闭。不自动报名、选派或同步足球中国。</p>
        {inputMethod !== "DOCX" ? <button className="admin-button admin-button-secondary" disabled={busy} onClick={() => void inspectColumns()} type="button">对应列 / 查看前 3 行</button> : <p className="admin-import-safety-note">只读取 Word 表格；淘汰赛为只读参考。时间、场地未知时可留空，安排时须填写真实信息。</p>}
        {columns.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr>{columns.map((c, i) => <th key={i}><span>{c}</span><select aria-label={`${c}对应字段`} value={mapping[c] ?? ""} onChange={(e) => { setMapping((old) => { const next = { ...old }; if (e.target.value) next[c] = e.target.value; else delete next[c]; return next; }); resetAnalysis(); }}><option value="">按已知列名识别</option><option value="ignore">忽略此列</option>{(importType === "TEAM" ? [["name", "球队名称"], ["teamType", "球队类型"], ["externalTeamId", "外部球队 ID"]] : [["homeTeam", "主队"], ["awayTeam", "客队"], ["kickoff", "开球时间"], ["endAt", "结束时间"], ["venue", "场地"], ["stage", "阶段"], ["group", "分组"], ["round", "轮次"], ["externalMatchId", "外部比赛 ID"], ["stageId", "阶段 ID（明确对应）"], ["groupId", "小组 ID（明确对应）"], ["roundId", "轮次 ID（明确对应）"]]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></th>)}</tr></thead><tbody>{samples.map((r, i) => <tr key={i}>{columns.map((_, j) => <td key={j}>{r[j]}</td>)}</tr>)}</tbody></table></div> : null}
        <footer><button className="admin-button" disabled={busy || !competitions.length} onClick={() => void request("preview")} type="button">{busy ? "处理中…" : "检查导入内容"}</button></footer>
      </div>
    </section>

    <p aria-live="polite" className="admin-form-message">{message}</p>

    {preview ? <section className="admin-panel">
      <header className="admin-panel-header"><div><h2>{preview.importType === "MATCH" ? "2. 对应球队与小组" : "2. 检查球队"}</h2><p>北京时间 · Asia/Shanghai</p></div><div className="admin-page-actions">{preview.summary.errorRows || preview.summary.conflictRows ? <button className="admin-button admin-button-secondary" onClick={downloadErrors} type="button">下载错误 CSV</button> : null}</div></header>
      <div className="admin-panel-body">
        <p className="admin-notice-success">{preview.publicImpact ? "该赛事已公开，提交后符合规则的新比赛会进入官网赛程。裁判报名关闭不影响公开赛程。" : "赛事未公开或为测试赛事，导入不会开启公开或首页候选。"}</p>
        {preview.importType === "MATCH" ? <section className="admin-form-section ops-import-mapping"><h3>核对真实球队与小组</h3><p>文件原名保留；推荐仅供核对。近似名称须明确选择并确认，修改后重新检查。重复名称只确认一次。</p><label>搜索本赛事球队<input value={mappingSearch} onChange={(e) => setMappingSearch(e.target.value)} /></label><div className="admin-table-scroll"><table className="admin-data-table"><thead><tr><th>文件队名 / 影响场次</th><th>推荐对应</th><th>确认真实球队</th></tr></thead><tbody>{preview.teamMappings?.filter((m) => !m.exactId).map((m) => <tr key={m.sourceName}><td><strong>{m.sourceName}</strong><small>影响 {m.affectedRows} 场</small></td><td>{m.candidates.map((c) => <p key={c.id}>{c.name} · {c.explanation}</p>)}</td><td><select aria-label={`${m.sourceName}对应球队`} value={teamMappings[m.sourceName] ?? m.exactId ?? ""} onChange={(e) => { setTeamMappings((old) => ({ ...old, [m.sourceName]: e.target.value })); setDocxDirty(true); setResult(null); }}><option value="">请选择本赛事真实球队</option>{preview.teamOptions?.filter((t) => t.name.includes(mappingSearch) || t.id === teamMappings[m.sourceName] || t.id === m.exactId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><small>{teamMappings[m.sourceName] || m.mappedId ? "管理员已选择，重新检查后生效" : m.exactId ? "唯一精确名称预填" : "推荐待确认"}</small></td></tr>)}</tbody></table></div><details><summary>精确对应的 {preview.teamMappings?.filter((m) => m.exactId).length ?? 0} 支球队已预填 · 展开核对或改选</summary><div className="admin-form-grid">{preview.teamMappings?.filter((m) => m.exactId).map((m) => <label key={m.sourceName}><span>{m.sourceName} · 影响 {m.affectedRows} 场</span><select aria-label={`${m.sourceName}对应球队`} value={teamMappings[m.sourceName] ?? m.exactId ?? ""} onChange={(e) => {setTeamMappings((old) => ({...old,[m.sourceName]:e.target.value}));setDocxDirty(true);}}>{preview.teamOptions?.filter((t) => t.name.includes(mappingSearch) || t.id === (teamMappings[m.sourceName] ?? m.exactId)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>)}</div></details><div className="admin-form-grid">{preview.groupMappings?.map((m) => <label key={m.sourceName}><span>文件小组：{m.sourceName}</span><select aria-label={`${m.sourceName}对应小组`} value={groupMappings[m.sourceName] ?? ""} onChange={(e) => { setGroupMappings((old) => ({ ...old, [m.sourceName]: e.target.value })); setDocxDirty(true); }}><option value="">按精确名称检查 / 选择确认</option>{groupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select><small>推荐：{m.candidates.map((c) => c.name).join("、") || "请自行选择"}；不会自动移动成员</small></label>)}</div><button type="button" className="admin-button" disabled={busy} onClick={() => void request("preview")}>确认对应并重新检查</button></section> : null}
        {preview.importType === "MATCH" ? <h3>3. 检查赛程与暂定信息</h3> : null}
        {preview.inputMethod === "DOCX" ? <>
          <div className="admin-import-blocked"><strong>淘汰赛结构 · 仅供参考</strong><p>识别 {preview.referenceRows?.length ?? 0} 场；系统不会创建正式比赛或占位球队。管理员确认出线后逐场选择真实球队。</p><div className="ops-detail-scroll">{preview.referenceRows?.map((r) => <p key={r.rowNumber}>第{String(r.values.matchNumber)}场 · {String(r.values.round)} · {String(r.values.homeTeam)} vs {String(r.values.awayTeam)}</p>)}</div></div>
          <div className="ops-docx-completion"><h3>核对对阵与可选排期</h3><p>日期、时间、场地未知时可留空导入为待排期。可批量补空值，也可逐场改排期与小组。每次修改后点击“重新检查”。</p><div className="admin-form-grid"><label><span>同一天</span><input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} /></label><label><span>同一时间</span><input type="time" value={bulkTime} onChange={(e) => setBulkTime(e.target.value)} /></label><label><span>同一场地</span><input value={bulkVenue} onChange={(e) => setBulkVenue(e.target.value)} /></label><button className="admin-button admin-button-secondary" type="button" onClick={() => { const next = { ...docxEdits }; for (const row of preview.rows.filter((r) => !excluded.includes(r.rowNumber))) { const key = String(row.rowNumber), patch = { ...(next[key] ?? {}) }; if (bulkDate && !(patch.date || row.raw.date)) patch.date = bulkDate; if (bulkTime && !(patch.time || row.raw.time)) patch.time = bulkTime; if (bulkVenue && !(patch.venue || row.raw.venue)) patch.venue = bulkVenue; next[key] = patch; } setDocxEdits(next); setDocxDirty(true); }}>批量补空值</button></div>
          <button className="admin-button admin-button-secondary" disabled={busy} type="button" onClick={() => void request("preview")}>重新检查补全内容</button></div>
        </> : null}
        {preview.inputWarnings.map((warning) => <p className="admin-import-warning" key={warning}>{warning}</p>)}
        <div className="admin-import-summary">{summaryItems.map((item) => <div data-key={item.key} key={item.key}><span>{item.label}</span><strong>{preview.summary[item.key]}</strong></div>)}</div>
        <p>本次导入：{preview.rows.length - preview.rows.filter((r) => excluded.includes(r.rowNumber)).length} 场 · 暂不导入：{excluded.length} 场 · 淘汰赛参考：{preview.referenceRows?.length ?? 0} 条</p>
        <p>待排期提醒：{preview.rows.filter((r) => !r.normalized.kickoff || !r.normalized.venue).length} 场时间或场地尚待安排；不阻止合法对阵导入。</p>
        <label><input type="checkbox" checked={onlyIssues} onChange={(e) => { setOnlyIssues(e.target.checked); setPreviewPage(1); }} />只看需要处理的场次</label>
        <div className="admin-table-scroll"><table className="admin-data-table admin-import-table"><thead><tr><th>选择 / 场序</th><th>对阵</th><th>阶段 / 小组 / 轮次</th><th>日期时间</th><th>场地</th><th>处理状态 / 操作</th></tr></thead><tbody>{preview.rows.filter((r) => !onlyIssues || r.errors.length).slice((previewPage-1)*30, previewPage*30).map((row) => <tr data-action={row.action} key={row.rowNumber}>
          <td><label><input type="checkbox" aria-label={`导入第${row.raw.matchNumber || row.rowNumber}场`} checked={!excluded.includes(row.rowNumber)} disabled={busy} onChange={(e) => { setExcluded((old) => e.target.checked ? old.filter((n) => n !== row.rowNumber) : [...old, row.rowNumber]); setDocxDirty(true); }} />{row.normalized.matchNumber ? `第${row.normalized.matchNumber}场` : `第${row.rowNumber}行`}</label></td>
          <td><strong>{row.normalized.homeTeam || row.normalized.name}</strong>{row.normalized.awayTeam ? <><small>vs</small><strong>{row.normalized.awayTeam}</strong></> : null}<details><summary>文件原文</summary><p>{row.raw.homeTeam} vs {row.raw.awayTeam}</p><p>{row.raw.date} {row.raw.time} {row.raw.kickoff}</p></details></td>
          <td>{[row.normalized.stage,row.normalized.group,row.normalized.round].filter(Boolean).join(" · ") || "未结构化"}</td>
          <td>{row.normalized.kickoff ? formatBeijingDateTime(new Date(row.normalized.kickoff)).dateTimeLabel : "时间待定"}{row.normalized.tentativeDate ? <small>暂定日期：{row.normalized.tentativeDate}</small> : null}{row.normalized.tentativeSchedule ? <small>暂定安排：{row.normalized.tentativeSchedule}</small> : null}</td><td>{row.normalized.venue || "场地待定"}</td>
          <td><span className="admin-status-badge">{excluded.includes(row.rowNumber) ? "本次暂不导入" : row.action === "CREATE" ? "可导入" : actionLabels[row.action]}</span>{row.errors.map((error) => <p className="admin-import-error" key={`${error.field}-${error.errorCode}`}>{error.errorCode === "GROUP_TEAM_MISMATCH" ? `球队分组需要确认：${error.teamNames?.join("、")}尚未确认属于${error.groupName}` : error.message}</p>)}{row.errors.some((e) => ["GROUP_TEAM_MISMATCH","GROUP_UNMATCHED","GROUP_INVALID"].includes(e.errorCode)) ? <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={() => void openGrouping()}>管理球队分组</button> : null}
          <details><summary>修改排期 / 分组</summary><div className="admin-form-grid">{["date","time","venue"].map((field) => <label key={field}><span>{({date:"暂定日期",time:"时间 / 暂定说明",venue:"场地"} as Record<string,string>)[field]}</span><input aria-label={`第${row.raw.matchNumber || row.rowNumber}场${field}`} value={docxEdits[row.rowNumber]?.[field] ?? row.raw[field] ?? ""} onChange={(e) => editDocx(row.rowNumber,field,e.target.value)} /></label>)}<label>正式开球时间（北京时间）<input value={docxEdits[row.rowNumber]?.kickoff ?? row.raw.kickoff ?? ""} onChange={(e) => editDocx(row.rowNumber,"kickoff",e.target.value)} /></label><label>小组<select value={docxEdits[row.rowNumber]?.groupId ?? row.normalized.groupId ?? ""} onChange={(e) => { const g = groupOptions.find((g) => g.id === e.target.value); setDocxEdits((old) => ({...old,[row.rowNumber]:{...(old[row.rowNumber] ?? {}),groupId:g?.id ?? "",stageId:g?.stageId ?? "",roundId:""}})); setDocxDirty(true); }}><option value="">按文件小组检查</option>{groupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>轮次<select value={docxEdits[row.rowNumber]?.roundId ?? row.normalized.roundId ?? ""} onChange={(e) => editDocx(row.rowNumber,"roundId",e.target.value)}><option value="">按文件轮次检查</option>{groupOptions.find((g) => g.id === (docxEdits[row.rowNumber]?.groupId ?? row.normalized.groupId))?.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div><button type="button" className="admin-button admin-button-secondary" onClick={() => editDocx(row.rowNumber,"pendingResolution","pending")}>保留原文并按待定导入</button><button type="button" onClick={() => editDocx(row.rowNumber,"pendingResolution","")}>恢复正式时间校验</button><p>{docxEdits[row.rowNumber]?.pendingResolution === "pending" ? "已明确选择保留原文并按待定处理，重新检查后生效。" : "修改后请重新检查"}</p></details>
          <details><summary>技术详情</summary><pre>{JSON.stringify({normalized:row.normalized,errors:row.errors,differences:row.differences},null,2)}</pre></details></td>
        </tr>)}</tbody></table></div>
        {preview.excludedRows?.length ? <details open><summary>暂不导入的 {preview.excludedRows.length} 场（保留供返回处理）</summary>{preview.excludedRows.map((r) => <p key={r.rowNumber}>第{String(r.values.matchNumber || r.rowNumber)}场：{String(r.values.homeTeam)} vs {String(r.values.awayTeam)} · 管理员明确暂不导入 <button type="button" onClick={() => {setExcluded((old) => old.filter((n) => n !== r.rowNumber));setDocxDirty(true);}}>恢复选择</button></p>)}</details> : null}
        <button className="admin-button admin-button-secondary" disabled={busy} type="button" onClick={() => void request("preview")}>重新检查所选集合</button>
        <div className="admin-pagination"><button disabled={previewPage <= 1} onClick={() => setPreviewPage((n) => n - 1)} type="button">上一页</button><span>{previewPage} / {Math.max(1, Math.ceil(preview.rows.length / 30))}</span><button disabled={previewPage * 30 >= preview.rows.length} onClick={() => setPreviewPage((n) => n + 1)} type="button">下一页</button></div>
        {commitBlocked ? <div className="admin-import-blocked"><strong>当前不能导入</strong><p>补全或修正错误后重新检查；淘汰赛仍须人工逐场创建。</p><div><Link href="/admin/organizations">手动维护球队</Link><Link href="/admin/matches">手动维护比赛</Link></div></div> : <div className="admin-import-confirm"><div><strong>4. 检查通过，可以确认导入</strong><p>提交会再次核对输入、分组及公开状态；变化时请重新检查。</p></div><button className="admin-button" disabled={busy} onClick={() => setConfirmOpen(true)} type="button">{busy ? "提交中…" : "确认导入"}</button></div>}
      </div>
    </section> : null}

    {result ? <section className="admin-panel admin-import-result">
      <header className="admin-panel-header"><div><h2>导入结果</h2><p>本次明确选择的集合已在一个事务中提交，并记录操作日志。暂不导入的场次仍保留在上方。</p></div></header>
      <div className="admin-panel-body"><dl><div><dt>创建球队</dt><dd>{result.createdTeams}</dd></div><div><dt>复用球队</dt><dd>{result.reusedTeams}</dd></div><div><dt>创建比赛</dt><dd>{result.createdMatches}</dd></div><div><dt>跳过重复比赛</dt><dd>{result.skippedMatches}</dd></div><div><dt>警告行</dt><dd>{result.warnings}</dd></div><div><dt>暂不导入</dt><dd>{result.preview.excludedRows?.length ?? 0}</dd></div></dl></div>
      <div className="admin-panel-body"><Link href={`/admin/competitions/${competitionId}?section=matches`}>查看分组赛程</Link> · <Link href={`/competitions/${result.preview.competition.slug}`}>查看官网效果（需已公开）</Link></div>
    </section> : null}
    {confirmOpen && preview ? <WorkspaceDialog title="确认导入所选赛程" busy={busy} onClose={() => setConfirmOpen(false)} footer={<button type="button" className="admin-button" disabled={busy || commitBlocked} onClick={async () => { await request("commit"); setConfirmOpen(false); }}>确认提交 {preview.rows.length} 场</button>}><p>赛事：{preview.competition.name}</p><p>本次选择 {preview.rows.length} 场，暂不导入 {preview.excludedRows?.length ?? 0} 场；淘汰赛参考 {preview.referenceRows?.length ?? 0} 条。裁判报名保持关闭。</p><p>服务器将重新核对真实球队、分组、暂定信息和当前结构；本次集合全部成功或全部回滚。</p></WorkspaceDialog> : null}
    {grouping ? <WorkspaceDialog title="管理球队分组" onClose={() => setGrouping(null)} busy={busy} footer={<button type="button" className="admin-button" disabled={busy} onClick={() => { setGrouping(null); void request("preview"); }}>返回并重新检查</button>}><p>已上传文件、对应关系和排期输入保留。保存分组后重新检查。</p><TeamGroupingManager competitionId={competitionId} stages={grouping.stages} teams={grouping.teams} canWrite={true} onSaved={async () => { await openGrouping(); setStructureVersion((v) => v + 1); setDocxDirty(true); }} /></WorkspaceDialog> : null}
  </div>;
}
