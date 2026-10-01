import { Parser } from "saxen";
import { CompetitionImportParseError } from "@/lib/competition-import-parser";
import { COMPETITION_IMPORT_MAX_CELL_CHARACTERS, COMPETITION_IMPORT_MAX_ROWS, type CompetitionImportParsedRow } from "@/lib/competition-import-types";
import { CompetitionImportXlsxPreflightError, readCompetitionImportWordXml } from "@/lib/competition-import-xlsx-security";

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };
function fail(message = "Word 表格结构无效；仅支持已核验的足球中国赛程表格式。"): never { throw new CompetitionImportParseError(message, 415); }
function parseXml(bytes: Buffer) {
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("Word XML 必须使用 UTF-8。"); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(xml)) fail("Word XML 不允许 DTD 或自定义实体。");
  const parser = new Parser();
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined, count = 0;
  parser.on("error", () => fail("Word XML 格式损坏。"));
  parser.on("warn", () => fail("Word XML 格式损坏。"));
  parser.on("attention", () => fail("Word XML 声明不受支持。"));
  parser.on("openTag", (name, attrs) => {
    if (++count > 200000 || stack.length >= 64) fail("Word XML 结构超出限制。");
    const node: XmlNode = { name, attrs: { ...attrs() }, children: [], text: "" };
    if (stack.length) stack.at(-1)!.children.push(node);
    else { if (root) fail(); root = node; }
    stack.push(node);
  });
  parser.on("text", (value, decode) => { if (stack.length) stack.at(-1)!.text += decode(value); else if (value.trim()) fail(); });
  parser.on("closeTag", (name) => { if (stack.pop()?.name !== name) fail(); });
  parser.parse(xml);
  if (stack.length || root?.name !== "w:document") fail();
  return root;
}
function child(node: XmlNode, name: string) { return node.children.find((c) => c.name === name); }
function text(node: XmlNode): string { return node.name === "w:t" ? node.text : node.children.map(text).join(""); }
function cellText(node: XmlNode) {
  const value = text(node).normalize("NFKC").trim();
  if (value.length > COMPETITION_IMPORT_MAX_CELL_CHARACTERS) fail("Word 单元格文字超出限制。");
  return value;
}
export function parseCompetitionImportDocx(buffer: Buffer) {
  let bytes: Buffer;
  try { bytes = readCompetitionImportWordXml(buffer); }
  catch (e) { if (e instanceof CompetitionImportXlsxPreflightError) throw new CompetitionImportParseError(e.message.replaceAll("Excel", "DOCX"), e.status); throw e; }
  const body = child(parseXml(bytes), "w:body");
  if (!body) fail();
  const rows: CompetitionImportParsedRow[] = [], referenceRows: CompetitionImportParsedRow[] = [];
  let stage = "", rowNumber = 0, tableCount = 0;
  for (const item of body.children) {
    if (item.name === "w:p") {
      const heading = cellText(item).match(/^阶段\s*[:：]\s*(小组赛|淘汰赛)$/);
      if (heading) stage = heading[1];
      continue;
    }
    if (item.name !== "w:tbl") continue;
    const tableRows = item.children.filter((n) => n.name === "w:tr");
    const headerCells = tableRows[0]?.children.filter((n) => n.name === "w:tc") ?? [];
    if (!headerCells.some((c) => cellText(c) === "场序")) continue;
    if (!stage) fail("赛程表缺少明确的阶段标题。");
    const header: string[] = [];
    for (const c of headerCells) {
      const span = Number(child(child(c, "w:tcPr") ?? c, "w:gridSpan")?.attrs["w:val"] ?? 1);
      const label = cellText(c);
      if (label === "对阵" && span === 2) header.push("主队", "客队");
      else if (span === 1) header.push(label);
      else fail();
    }
    if (header.join("|") !== "轮次|场序|日期|时间|主队|客队|场地|备注") fail("Word 赛程列结构不匹配（对阵须为两个实际单元格）。");
    tableCount++;
    let previous: string[] = [];
    for (const tr of tableRows.slice(1)) {
      const values: string[] = [];
      for (const c of tr.children.filter((n) => n.name === "w:tc")) {
        const props = child(c, "w:tcPr");
        if (Number(props && child(props, "w:gridSpan")?.attrs["w:val"] || 1) !== 1) fail();
        const merge = props && child(props, "w:vMerge");
        values.push(merge && merge.attrs["w:val"] !== "restart" ? previous[values.length] ?? "" : cellText(c));
      }
      if (values.length !== 8) fail();
      previous = values;
      if (values.every((v) => !v)) continue;
      if (++rowNumber > COMPETITION_IMPORT_MAX_ROWS) fail("Word 赛程不能超过 5000 行。");
      const [round, matchNumber, date, time, homeTeam, awayTeam, venue, note] = values;
      const group = note.replace(/^备注\s*[:：]\s*/, "").match(/(?:^|[\s，,;；])([^\s，,;；:：]+组)(?=$|[\s，,;；])/u)?.[1] ?? note.replace(/^备注\s*[:：]\s*/, "").trim();
      const row = { rowNumber, values: { stage, round, matchNumber, date, time, homeTeam, awayTeam, venue, note, group, kickoff: date && time ? `${date} ${time}` : "" } };
      (stage === "淘汰赛" ? referenceRows : rows).push(row);
    }
  }
  if (!tableCount || !rows.length && !referenceRows.length) fail("没有找到支持的足球中国 Word 赛程表。");
  return { rows, referenceRows, columns: ["阶段", "轮次", "场序", "日期", "时间", "主队", "客队", "场地", "备注"], samples: rows.slice(0, 3).map((r) => [r.values.stage, r.values.round, r.values.matchNumber, r.values.date, r.values.time, r.values.homeTeam, r.values.awayTeam, r.values.venue, r.values.note].map(String)), inputWarnings: ["仅解析已核验的足球中国 Word 表格结构。小组赛需匹配本赛事真实球队、已有小组与轮次；淘汰赛仅供参考，不创建球队或比赛。"] };
}

// Completion edits cannot change teams, stage classification, match numbers or reference rows.
export function completeDocxRows(rows: CompetitionImportParsedRow[], edits: unknown) {
  if (!edits || typeof edits !== "object" || Array.isArray(edits) || Object.keys(edits).length > COMPETITION_IMPORT_MAX_ROWS) fail("Word 补全数据无效。");
  const allowed = ["date", "time", "venue", "stageId", "groupId", "roundId", "kickoff", "endAt", "pendingResolution", "tentativeSchedule"];
  const byNumber = new Map(rows.map((r) => [String(r.rowNumber), r]));
  for (const [key, patch] of Object.entries(edits)) {
    if (!byNumber.has(key) || !patch || typeof patch !== "object" || Array.isArray(patch) || Object.entries(patch).some(([field, value]) => !allowed.includes(field) || typeof value !== "string" || value.length > 120)) fail("Word 补全字段无效。");
  }
  return rows.map((r) => {
    const patch = (edits as Record<string, Record<string, string>>)[r.rowNumber] ?? {};
    const values = { ...r.values, ...patch };
    if (Object.hasOwn(values, "date") || Object.hasOwn(values, "time")) values.kickoff = values.date && values.time ? `${values.date} ${values.time}` : "";
    return { ...r, values };
  });
}
