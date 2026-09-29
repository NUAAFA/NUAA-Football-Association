export const COMPETITION_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const COMPETITION_IMPORT_MAX_ROWS = 5_000;
export const COMPETITION_IMPORT_MAX_COLUMNS = 32;
export const COMPETITION_IMPORT_MAX_CELL_CHARACTERS = 2_048;
export const COMPETITION_IMPORT_XLSX_MAX_ZIP_ENTRIES = 128;
export const COMPETITION_IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const COMPETITION_IMPORT_XLSX_MAX_XML_ENTRY_BYTES = 8 * 1024 * 1024;
export const COMPETITION_IMPORT_XLSX_MAX_COMPRESSION_RATIO = 120;
export const COMPETITION_IMPORT_XLSX_MAX_WORKSHEETS = 8;
export const COMPETITION_IMPORT_XLSX_MAX_CELLS = (COMPETITION_IMPORT_MAX_ROWS + 1) * COMPETITION_IMPORT_MAX_COLUMNS;

export type CompetitionImportType = "TEAM" | "MATCH";
export type CompetitionImportInputMethod = "CSV" | "XLSX" | "PASTE" | "DOCX";
export type CompetitionImportAction =
  | "CREATE"
  | "REUSE_EXISTING"
  | "SKIP_DUPLICATE"
  | "CONFLICT"
  | "ERROR";

export type CompetitionImportCell = string | number | boolean | Date | null;

export type CompetitionImportParsedRow = {
  rowNumber: number;
  values: Record<string, CompetitionImportCell>;
};

export type CompetitionImportInput = {
  referenceRows?: CompetitionImportParsedRow[];
  competitionId: string;
  importType: CompetitionImportType;
  inputMethod: CompetitionImportInputMethod;
  inputHash: string;
  rows: CompetitionImportParsedRow[];
  inputWarnings: string[];
  expectedPlanHash?: string;
  columns?: string[];
  samples?: string[][];
};

export type CompetitionImportIssue = {
  field: string;
  errorCode: string;
  message: string;
};

export type CompetitionImportTeamAction = {
  name: string;
  action: "CREATE_TEAM" | "REUSE_EXISTING" | "REUSE_PLANNED";
};

export type CompetitionImportPreviewRow = {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: Record<string, string | null>;
  action: CompetitionImportAction;
  warnings: CompetitionImportIssue[];
  errors: CompetitionImportIssue[];
  differences?: Record<string, { existing: string | null; imported: string | null }>;
  teamActions?: CompetitionImportTeamAction[];
  slug?: string;
};

export type CompetitionImportSummary = {
  totalRows: number;
  validRows: number;
  createRows: number;
  reuseRows: number;
  skipRows: number;
  warningRows: number;
  conflictRows: number;
  errorRows: number;
  plannedTeamCreates: number;
};

export type CompetitionImportPreview = {
  referenceRows?: CompetitionImportParsedRow[];
  publicImpact: boolean;
  planHash: string;
  competition: { id: string; name: string; slug: string };
  importType: CompetitionImportType;
  inputMethod: CompetitionImportInputMethod;
  inputHash: string;
  inputWarnings: string[];
  summary: CompetitionImportSummary;
  rows: CompetitionImportPreviewRow[];
};

export type CompetitionImportCommitResult = {
  ok: true;
  auditId: string;
  inputHash: string;
  createdTeams: number;
  reusedTeams: number;
  createdMatches: number;
  skippedMatches: number;
  warnings: number;
  preview: CompetitionImportPreview;
};

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCompetitionImportErrorCsv(preview: CompetitionImportPreview) {
  const rows: Array<Array<string | number>> = [["row", "field", "code", "message"]];
  for (const row of preview.rows) {
    for (const issue of row.errors) {
      rows.push([row.rowNumber, issue.field, issue.errorCode, issue.message]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
