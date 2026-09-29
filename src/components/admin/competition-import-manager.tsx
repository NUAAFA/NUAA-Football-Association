"use client";

import Link from "next/link";
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

function payloadSummary(value: Record<string, string | null>) {
  return Object.entries(value)
    .filter(([, item]) => item !== null && item !== "")
    .map(([key, item]) => `${({ homeTeamName: "主队", awayTeamName: "客队", kickoff: "开球（北京时间）", endAt: "结束（北京时间）", stage: "阶段", group: "小组", round: "轮次", venue: "场地" } as Record<string,string>)[key] ?? key}: ${item && ["kickoff", "endAt"].includes(key) ? formatBeijingDateTime(new Date(item)).dateTimeLabel : item}`)
    .join(" · ");
}

export function CompetitionImportManager({ competitions, initialCompetitionId, initialType = "TEAM" }: { competitions: CompetitionOption[]; initialCompetitionId?: string; initialType?: CompetitionImportType }) {
  const [competitionId, setCompetitionId] = useState(initialCompetitionId && competitions.some((c) => c.id === initialCompetitionId) ? initialCompetitionId : competitions[0]?.id ?? "");
  const [importType, setImportType] = useState<CompetitionImportType>(initialType);
  const [inputMethod, setInputMethod] = useState<CompetitionImportInputMethod>("CSV");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CompetitionImportPreview | null>(null);
  const [result, setResult] = useState<CompetitionImportCommitResult | null>(null);
  const [message, setMessage] = useState("");
  const [docxEdits, setDocxEdits] = useState<Record<string, Record<string, string>>>({});
  const [docxDirty, setDocxDirty] = useState(false);
  const [groupOptions, setGroupOptions] = useState<Array<{ id: string; name: string; stageId: string; rounds: Array<{ id: string; name: string }> }>>([]);
  const [bulkDate, setBulkDate] = useState(""), [bulkTime, setBulkTime] = useState(""), [bulkVenue, setBulkVenue] = useState("");
  useEffect(() => {
    if (inputMethod !== "DOCX" || !competitionId) return;
    const controller = new AbortController();
    fetch(`/api/admin/competitions/${competitionId}/structure`, { signal: controller.signal }).then((r) => r.json()).then((d) => {
      if (!controller.signal.aborted && Array.isArray(d.stages)) setGroupOptions(d.stages.filter((stage: { type: string }) => stage.type === "GROUP").flatMap((stage: { id: string; groups: Array<{ id: string; name: string }>; rounds: Array<{ id: string; name: string; groupId: string | null }> }) => stage.groups.map((group) => ({ id: group.id, name: group.name, stageId: stage.id, rounds: stage.rounds.filter((round) => !round.groupId || round.groupId === group.id).map((round) => ({ id: round.id, name: round.name })) }))));
    }).catch(() => {});
    return () => controller.abort();
  }, [competitionId, inputMethod]);
  const [busy, setBusy] = useState(false);
  const [columns, setColumns] = useState<string[]>([]), [samples, setSamples] = useState<string[][]>([]), [mapping, setMapping] = useState<Record<string, string>>({}), [previewPage, setPreviewPage] = useState(1);

  function resetAnalysis() {
    setPreview(null);
    setResult(null);
    setMessage("");
    setDocxEdits({}); setDocxDirty(false);
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
    if (inputMethod === "DOCX") form.set("docxEdits", JSON.stringify(docxEdits));
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

  const commitBlocked = docxDirty || !preview || preview.summary.errorRows > 0 || preview.summary.conflictRows > 0;
  const pastePlaceholder = importType === "TEAM"
    ? "name\tteamType\n计算机学院\tORGANIZATION\n自由组队A\tFREEFORM"
    : "主队\t客队\t开球时间\t结束时间\t场地\t阶段\t分组\t轮次\n计算机学院\t电子信息工程学院\t2026-10-15 18:30\t\t天目湖校区足球场\t小组赛\tA组\t第1轮";

  return <div className="admin-import-workflow">
    <section className="admin-panel">
      <header className="admin-panel-header"><div><h2>1. 选择赛事与导入域</h2><p>先选赛事，再选择球队或赛程。</p></div></header>
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
      <header className="admin-panel-header"><div><h2>2. 选择输入方式</h2><p>文件支持 CSV、XLSX 和已核验的足球中国 DOCX 赛程；粘贴支持逗号或制表符分隔，读取首个工作表。上限 5 MB / 5000 行。</p></div><div className="admin-page-actions"><a className="admin-button admin-button-secondary" href={`/api/admin/competitions/import/templates/${importType === "TEAM" ? "team" : "match"}`}>下载当前 CSV 模板</a></div></header>
      <div className="admin-panel-body admin-form">
        <div className="admin-import-methods" role="radiogroup" aria-label="输入方式">
          {(["CSV", "XLSX", "PASTE", ...(importType === "MATCH" ? ["DOCX" as const] : [])] as const).map((method) => <button aria-checked={inputMethod === method} className={inputMethod === method ? "is-active" : ""} key={method} onClick={() => { setInputMethod(method); setFile(null); setContent(""); setColumns([]); setSamples([]); setMapping({}); resetAnalysis(); }} role="radio" type="button">{method === "PASTE" ? "批量粘贴" : method}</button>)}
        </div>
        {inputMethod === "PASTE" ? <label><span>TSV / Excel 粘贴内容（也可识别明确 CSV；球队可每行一个名称）</span><textarea onChange={(event) => { setContent(event.target.value); setColumns([]); setSamples([]); setMapping({}); resetAnalysis(); }} placeholder={pastePlaceholder} rows={10} value={content} /></label> : <label><span>选择 {inputMethod === "CSV" ? "UTF-8 CSV" : inputMethod === "DOCX" ? "Word .docx" : "Excel .xlsx"} 文件</span><input accept={inputMethod === "CSV" ? ".csv,text/csv" : inputMethod === "DOCX" ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setColumns([]); setSamples([]); setMapping({}); resetAnalysis(); }} type="file" /></label>}
        <p className="admin-import-safety-note">导入记录人工确认的赛程，新比赛保持“已安排”、裁判报名关闭。不自动报名、选派或同步足球中国。</p>
        {inputMethod !== "DOCX" ? <button className="admin-button admin-button-secondary" disabled={busy} onClick={() => void inspectColumns()} type="button">对应列 / 查看前 3 行</button> : <p className="admin-import-safety-note">只读取 Word 表格；淘汰赛为只读参考。时间、场地必须是真实信息，补全后再次检查。</p>}
        {columns.length ? <div className="admin-table-scroll"><table className="admin-data-table"><thead><tr>{columns.map((c, i) => <th key={i}><span>{c}</span><select aria-label={`${c}对应字段`} value={mapping[c] ?? ""} onChange={(e) => { setMapping((old) => { const next = { ...old }; if (e.target.value) next[c] = e.target.value; else delete next[c]; return next; }); resetAnalysis(); }}><option value="">按已知列名识别</option><option value="ignore">忽略此列</option>{(importType === "TEAM" ? [["name", "球队名称"], ["teamType", "球队类型"], ["externalTeamId", "外部球队 ID"]] : [["homeTeam", "主队"], ["awayTeam", "客队"], ["kickoff", "开球时间"], ["endAt", "结束时间"], ["venue", "场地"], ["stage", "阶段"], ["group", "分组"], ["round", "轮次"], ["externalMatchId", "外部比赛 ID"], ["stageId", "阶段 ID（明确对应）"], ["groupId", "小组 ID（明确对应）"], ["roundId", "轮次 ID（明确对应）"]]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></th>)}</tr></thead><tbody>{samples.map((r, i) => <tr key={i}>{columns.map((_, j) => <td key={j}>{r[j]}</td>)}</tr>)}</tbody></table></div> : null}
        <footer><button className="admin-button" disabled={busy || !competitions.length} onClick={() => void request("preview")} type="button">{busy ? "处理中…" : "检查导入内容"}</button></footer>
      </div>
    </section>

    <p aria-live="polite" className="admin-form-message">{message}</p>

    {preview ? <section className="admin-panel">
      <header className="admin-panel-header"><div><h2>检查赛程</h2><p>北京时间 · Asia/Shanghai</p></div><div className="admin-page-actions">{preview.summary.errorRows || preview.summary.conflictRows ? <button className="admin-button admin-button-secondary" onClick={downloadErrors} type="button">下载错误 CSV</button> : null}</div></header>
      <div className="admin-panel-body">
        <p className="admin-notice-success">{preview.publicImpact ? "该赛事已公开，提交后符合规则的新比赛会进入官网赛程。裁判报名关闭不影响公开赛程。" : "赛事未公开或为测试赛事，导入不会开启公开或首页候选。"}</p>
        {preview.inputMethod === "DOCX" ? <>
          <div className="admin-import-blocked"><strong>淘汰赛结构 · 仅供参考</strong><p>识别 {preview.referenceRows?.length ?? 0} 场；系统不会创建正式比赛或占位球队。管理员确认出线后逐场选择真实球队。</p><div className="ops-detail-scroll">{preview.referenceRows?.map((r) => <p key={r.rowNumber}>第{String(r.values.matchNumber)}场 · {String(r.values.round)} · {String(r.values.homeTeam)} vs {String(r.values.awayTeam)}</p>)}</div></div>
          <div className="ops-docx-completion"><h3>补全小组赛真实信息</h3><p>可批量补空值，也可逐场改日期、时间、场地与小组。每次修改后点击“重新检查”。</p><div className="admin-form-grid"><label><span>同一天</span><input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} /></label><label><span>同一时间</span><input type="time" value={bulkTime} onChange={(e) => setBulkTime(e.target.value)} /></label><label><span>同一场地</span><input value={bulkVenue} onChange={(e) => setBulkVenue(e.target.value)} /></label><button className="admin-button admin-button-secondary" type="button" onClick={() => { const next = { ...docxEdits }; for (const row of preview.rows) { const key = String(row.rowNumber), patch = { ...(next[key] ?? {}) }; if (bulkDate && !(patch.date || row.raw.date)) patch.date = bulkDate; if (bulkTime && !(patch.time || row.raw.time)) patch.time = bulkTime; if (bulkVenue && !(patch.venue || row.raw.venue)) patch.venue = bulkVenue; next[key] = patch; } setDocxEdits(next); setDocxDirty(true); }}>批量补空值</button></div>
          <div className="admin-table-scroll"><table className="admin-data-table ops-docx-table"><thead><tr><th>场序 / 对阵</th><th>日期</th><th>时间</th><th>场地</th><th>小组</th><th>轮次</th></tr></thead><tbody>{preview.rows.slice((previewPage - 1) * 30, previewPage * 30).map((row) => { const patch = docxEdits[row.rowNumber] ?? {}; const selectedGroup = groupOptions.find((g) => g.id === (patch.groupId ?? row.normalized.groupId)); return <tr key={row.rowNumber}><td><strong>第{row.raw.matchNumber}场</strong><small>{row.raw.homeTeam} vs {row.raw.awayTeam}</small></td><td><input aria-label={`第${row.rowNumber}场日期`} type="date" value={patch.date ?? row.raw.date ?? ""} onChange={(e) => editDocx(row.rowNumber, "date", e.target.value)} /></td><td><input aria-label={`第${row.rowNumber}场时间`} type="time" value={patch.time ?? row.raw.time ?? ""} onChange={(e) => editDocx(row.rowNumber, "time", e.target.value)} /></td><td><input aria-label={`第${row.rowNumber}场场地`} value={patch.venue ?? row.raw.venue ?? ""} onChange={(e) => editDocx(row.rowNumber, "venue", e.target.value)} /></td><td><select aria-label={`第${row.rowNumber}场小组`} value={patch.groupId ?? row.normalized.groupId ?? ""} onChange={(e) => { const group = groupOptions.find((g) => g.id === e.target.value); setDocxEdits((old) => ({ ...old, [row.rowNumber]: { ...(old[row.rowNumber] ?? {}), groupId: group?.id ?? "", stageId: group?.stageId ?? "", roundId: "" } })); setDocxDirty(true); }}><option value="">{row.raw.group || "选择小组"} · 未匹配</option>{groupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></td><td><select aria-label={`第${row.rowNumber}场轮次`} value={patch.roundId ?? row.normalized.roundId ?? ""} onChange={(e) => editDocx(row.rowNumber, "roundId", e.target.value)}><option value="">{row.raw.round || "选择轮次"} · 未匹配</option>{selectedGroup?.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td></tr>; })}</tbody></table></div><button className="admin-button" disabled={busy} type="button" onClick={() => void request("preview")}>{docxDirty ? "重新检查补全内容" : "再次检查"}</button></div>
        </> : null}
        {preview.inputWarnings.map((warning) => <p className="admin-import-warning" key={warning}>{warning}</p>)}
        <div className="admin-import-summary">{summaryItems.map((item) => <div data-key={item.key} key={item.key}><span>{item.label}</span><strong>{preview.summary[item.key]}</strong></div>)}</div>
        {preview.importType === "MATCH" && preview.inputMethod !== "DOCX" ? <p className="admin-import-team-plan">本次赛程导入将额外创建 <strong>{preview.summary.plannedTeamCreates}</strong> 支未知球队；球队与比赛将在同一事务中提交。</p> : null}
        <div className="admin-table-scroll"><table className="admin-data-table admin-import-table"><thead><tr><th>行</th><th>检查内容（时间为 UTC，对应北京时间 +8 小时）</th><th>动作</th><th>球队处理</th><th>警告 / 错误</th></tr></thead><tbody>{preview.rows.slice((previewPage - 1) * 30, previewPage * 30).map((row) => <tr data-action={row.action} key={row.rowNumber}>
          <td><strong>{row.normalized.matchNumber ? `第${row.normalized.matchNumber}场` : row.rowNumber}</strong></td>
          <td><small>{payloadSummary(row.normalized)}</small>{row.slug ? <code>{row.slug}</code> : null}{row.differences ? <details><summary>查看字段差异</summary><pre>{JSON.stringify(row.differences, null, 2)}</pre></details> : null}</td>
          <td><span className="admin-status-badge" data-status={row.action}>{actionLabels[row.action]}</span></td>
          <td>{row.teamActions?.map((team) => <span className="admin-import-team-action" key={`${team.name}-${team.action}`}>{team.name}: {team.action}</span>) ?? "—"}</td>
          <td>{row.warnings.map((warning) => <p className="admin-import-warning" key={`${warning.field}-${warning.errorCode}`}>{warning.field} · {warning.errorCode}: {warning.message}</p>)}{row.errors.map((error) => <p className="admin-import-error" key={`${error.field}-${error.errorCode}`}>{error.field} · {error.errorCode}: {error.message}</p>)}{!row.warnings.length && !row.errors.length ? "—" : null}</td>
        </tr>)}</tbody></table></div>
        <div className="admin-pagination"><button disabled={previewPage <= 1} onClick={() => setPreviewPage((n) => n - 1)} type="button">上一页</button><span>{previewPage} / {Math.max(1, Math.ceil(preview.rows.length / 30))}</span><button disabled={previewPage * 30 >= preview.rows.length} onClick={() => setPreviewPage((n) => n + 1)} type="button">下一页</button></div>
        {commitBlocked ? <div className="admin-import-blocked"><strong>当前不能导入</strong><p>补全或修正错误后重新检查；淘汰赛仍须人工逐场创建。</p><div><Link href="/admin/organizations">手动维护球队</Link><Link href="/admin/matches">手动维护比赛</Link></div></div> : <div className="admin-import-confirm"><div><strong>检查通过，可以导入</strong><p>提交会再次核对输入、分组及公开状态；变化时请重新检查。</p></div><button className="admin-button" disabled={busy} onClick={() => { if (window.confirm("确认按当前输入执行原子导入？服务器会重新校验全部行。")) void request("commit"); }} type="button">{busy ? "提交中…" : "确认导入"}</button></div>}
      </div>
    </section> : null}

    {result ? <section className="admin-panel admin-import-result">
      <header className="admin-panel-header"><div><h2>导入结果</h2><p>批次已提交并写入 COMPETITION_IMPORT_COMMITTED AuditLog。</p></div></header>
      <div className="admin-panel-body"><dl><div><dt>创建球队</dt><dd>{result.createdTeams}</dd></div><div><dt>复用球队</dt><dd>{result.reusedTeams}</dd></div><div><dt>创建比赛</dt><dd>{result.createdMatches}</dd></div><div><dt>跳过重复比赛</dt><dd>{result.skippedMatches}</dd></div><div><dt>警告行</dt><dd>{result.warnings}</dd></div><div><dt>操作日志编号</dt><dd><code>{result.auditId}</code></dd></div></dl></div>
      <div className="admin-panel-body"><Link href={`/admin/competitions/${competitionId}?section=matches`}>查看分组赛程</Link> · <Link href={`/competitions/${result.preview.competition.slug}`}>查看官网效果（需已公开）</Link></div>
    </section> : null}
  </div>;
}
