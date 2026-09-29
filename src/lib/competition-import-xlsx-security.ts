import { inflateRawSync } from "node:zlib";

import {
  COMPETITION_IMPORT_MAX_COLUMNS,
  COMPETITION_IMPORT_MAX_FILE_BYTES,
  COMPETITION_IMPORT_MAX_ROWS,
  COMPETITION_IMPORT_XLSX_MAX_CELLS,
  COMPETITION_IMPORT_XLSX_MAX_COMPRESSION_RATIO,
  COMPETITION_IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES,
  COMPETITION_IMPORT_XLSX_MAX_WORKSHEETS,
  COMPETITION_IMPORT_XLSX_MAX_XML_ENTRY_BYTES,
  COMPETITION_IMPORT_XLSX_MAX_ZIP_ENTRIES,
} from "@/lib/competition-import-types";

const endOfCentralDirectorySignature = 0x06054b50;
const centralDirectoryEntrySignature = 0x02014b50;
const localFileHeaderSignature = 0x04034b50;
const maximumZipCommentBytes = 65_535;

type ZipEntry = {
  path: string;
  flags: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export class CompetitionImportXlsxPreflightError extends Error {
  constructor(
    message: string,
    readonly status: 413 | 415,
  ) {
    super(message);
    this.name = "CompetitionImportXlsxPreflightError";
  }
}

function invalidWorkbook(message = "Excel 文件 ZIP 结构无效或不受支持。"): never {
  throw new CompetitionImportXlsxPreflightError(message, 415);
}

function resourceLimit(message: string): never {
  throw new CompetitionImportXlsxPreflightError(message, 413);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.byteLength - 22 - maximumZipCommentBytes);
  for (let offset = buffer.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== endOfCentralDirectorySignature) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.byteLength) return offset;
  }
  return -1;
}

function safeZipPath(value: string) {
  if (
    !value
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value)
    || value.split("/").some((segment) => segment === "..")
  ) invalidWorkbook();
  return value;
}

function readCentralDirectory(buffer: Buffer) {
  if (buffer.byteLength < 22) invalidWorkbook();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) invalidWorkbook();

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || entriesOnDisk !== entryCount
    || entryCount === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) invalidWorkbook("Excel 文件不能使用多卷或 ZIP64 格式。");
  if (entryCount > COMPETITION_IMPORT_XLSX_MAX_ZIP_ENTRIES) {
    resourceLimit(`Excel ZIP 条目不能超过 ${COMPETITION_IMPORT_XLSX_MAX_ZIP_ENTRIES} 个。`);
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryOffset < 0 || centralDirectoryEnd > eocdOffset) invalidWorkbook();

  const entries: ZipEntry[] = [];
  const paths = new Set<string>();
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || buffer.readUInt32LE(offset) !== centralDirectoryEntrySignature) {
      invalidWorkbook();
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (
      nextOffset > centralDirectoryEnd
      || diskStart !== 0
      || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
      || (flags & 0x1) !== 0
    ) invalidWorkbook();

    const entryPath = safeZipPath(buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength));
    const normalizedPath = entryPath.toLocaleLowerCase("en-US");
    if (paths.has(normalizedPath)) invalidWorkbook("Excel ZIP 包含重复条目。");
    paths.add(normalizedPath);
    entries.push({ path: entryPath, flags, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nextOffset;
  }
  if (offset !== centralDirectoryEnd) invalidWorkbook();
  return { entries, centralDirectoryOffset };
}

function ratio(uncompressed: number, compressed: number) {
  if (uncompressed === 0) return 0;
  if (compressed === 0) return Number.POSITIVE_INFINITY;
  return uncompressed / compressed;
}

function readEntry(buffer: Buffer, entry: ZipEntry, centralDirectoryOffset: number) {
  const offset = entry.localHeaderOffset;
  if (offset < 0 || offset + 30 > centralDirectoryOffset || buffer.readUInt32LE(offset) !== localFileHeaderSignature) {
    invalidWorkbook();
  }
  const localFlags = buffer.readUInt16LE(offset + 6);
  const localCompressionMethod = buffer.readUInt16LE(offset + 8);
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (
    buffer.toString("utf8", offset + 30, offset + 30 + fileNameLength) !== entry.path
    || localFlags !== entry.flags
    ||
    (localFlags & 0x1) !== 0
    || localCompressionMethod !== entry.compressionMethod
    || dataOffset > centralDirectoryOffset
    || dataEnd > centralDirectoryOffset
  ) invalidWorkbook();

  const compressed = buffer.subarray(dataOffset, dataEnd);
  let content: Buffer;
  try {
    if (entry.compressionMethod === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) invalidWorkbook();
      content = compressed;
    } else if (entry.compressionMethod === 8) {
      content = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
    } else {
      invalidWorkbook("Excel XML 使用了不受支持的 ZIP 压缩方式。");
    }
  } catch (error) {
    if (error instanceof CompetitionImportXlsxPreflightError) throw error;
    invalidWorkbook();
  }
  if (content.byteLength !== entry.uncompressedSize) invalidWorkbook();
  return content;
}

// Reuse the same bounded ZIP reader for a specific OOXML part; never extract to disk.
export function readCompetitionImportWordXml(buffer: Buffer) {
  if (buffer.length > COMPETITION_IMPORT_MAX_FILE_BYTES) resourceLimit("DOCX 文件不能超过 5 MB。");
  const { entries, centralDirectoryOffset } = readCentralDirectory(buffer);
  let total = 0;
  for (const entry of entries) {
    total += entry.uncompressedSize;
    if (total > COMPETITION_IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES || entry.uncompressedSize > COMPETITION_IMPORT_XLSX_MAX_XML_ENTRY_BYTES || ratio(entry.uncompressedSize, entry.compressedSize) > COMPETITION_IMPORT_XLSX_MAX_COMPRESSION_RATIO) resourceLimit("DOCX 解压大小或压缩比超出限制。");
    if (![0, 8].includes(entry.compressionMethod)) invalidWorkbook("DOCX ZIP 压缩方式不受支持。");
    if (/vbaProject/i.test(entry.path)) invalidWorkbook("不支持含宏的 Word 文件。");
  }
  const document = entries.find((e) => e.path === "word/document.xml");
  const types = entries.find((e) => e.path === "[Content_Types].xml");
  if (!document || !types) invalidWorkbook("文件不是包含 Word 正文的 DOCX。");
  const contentTypes = readEntry(buffer, types, centralDirectoryOffset).toString("utf8");
  if (!contentTypes.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) invalidWorkbook("不支持此 Word 文档类型。");
  return readEntry(buffer, document, centralDirectoryOffset);
}

function columnNumber(reference: string) {
  let value = 0;
  for (const character of reference.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}

function inspectWorksheetXml(content: Buffer) {
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    invalidWorkbook("Excel 工作表 XML 必须使用 UTF-8 编码。");
  }

  let maximumRow = 0;
  let maximumColumn = 0;
  const dimension = xml.match(/<(?:[A-Za-z_][\w.-]*:)?dimension\b[^>]*\bref\s*=\s*["']([A-Z]{1,3}[1-9]\d*(?::[A-Z]{1,3}[1-9]\d*)?)["']/iu)?.[1];
  if (dimension) {
    for (const reference of dimension.split(":")) {
      const match = reference.match(/^([A-Z]{1,3})([1-9]\d*)$/iu);
      if (!match) invalidWorkbook("Excel 工作表维度格式无效。");
      maximumColumn = Math.max(maximumColumn, columnNumber(match[1]));
      maximumRow = Math.max(maximumRow, Number(match[2]));
    }
  }

  let cells = 0;
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>/giu)) {
    cells += 1;
    if (cells > COMPETITION_IMPORT_XLSX_MAX_CELLS) {
      resourceLimit(`Excel 单元格总数不能超过 ${COMPETITION_IMPORT_XLSX_MAX_CELLS} 个。`);
    }
    const reference = match[1].match(/\br\s*=\s*["']([A-Z]{1,3})([1-9]\d*)["']/iu);
    if (!reference) invalidWorkbook("Excel 工作表单元格缺少有效坐标。");
    maximumColumn = Math.max(maximumColumn, columnNumber(reference[1]));
    maximumRow = Math.max(maximumRow, Number(reference[2]));
  }
  if (maximumRow > COMPETITION_IMPORT_MAX_ROWS + 1) {
    resourceLimit(`Excel 工作表行号不能超过 ${COMPETITION_IMPORT_MAX_ROWS + 1}（含表头）。`);
  }
  if (maximumColumn > COMPETITION_IMPORT_MAX_COLUMNS) {
    resourceLimit(`Excel 工作表列数不能超过 ${COMPETITION_IMPORT_MAX_COLUMNS} 列。`);
  }
  return { cells, maximumRow, maximumColumn };
}

export function inspectCompetitionImportXlsx(buffer: Buffer) {
  if (buffer.byteLength > COMPETITION_IMPORT_MAX_FILE_BYTES) {
    resourceLimit(`Excel 压缩文件不能超过 ${COMPETITION_IMPORT_MAX_FILE_BYTES / 1024 / 1024} MB。`);
  }
  const { entries, centralDirectoryOffset } = readCentralDirectory(buffer);
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    totalCompressedBytes += entry.compressedSize;
    totalUncompressedBytes += entry.uncompressedSize;
    if (totalUncompressedBytes > COMPETITION_IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES) {
      resourceLimit(`Excel ZIP 解压后总大小不能超过 ${COMPETITION_IMPORT_XLSX_MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB。`);
    }
    if (!entry.path.endsWith("/") && ratio(entry.uncompressedSize, entry.compressedSize) > COMPETITION_IMPORT_XLSX_MAX_COMPRESSION_RATIO) {
      resourceLimit(`Excel ZIP 单条目压缩比不能超过 ${COMPETITION_IMPORT_XLSX_MAX_COMPRESSION_RATIO}:1。`);
    }
    if (/\.xml(?:\.rels)?$/iu.test(entry.path) && entry.uncompressedSize > COMPETITION_IMPORT_XLSX_MAX_XML_ENTRY_BYTES) {
      resourceLimit(`Excel XML 单条目解压后不能超过 ${COMPETITION_IMPORT_XLSX_MAX_XML_ENTRY_BYTES / 1024 / 1024} MB。`);
    }
  }
  const totalCompressionRatio = ratio(totalUncompressedBytes, totalCompressedBytes);
  if (totalCompressionRatio > COMPETITION_IMPORT_XLSX_MAX_COMPRESSION_RATIO) {
    resourceLimit(`Excel ZIP 总压缩比不能超过 ${COMPETITION_IMPORT_XLSX_MAX_COMPRESSION_RATIO}:1。`);
  }

  const parserXmlEntries = entries.filter((entry) => /\.xml(?:\.rels)?$/iu.test(entry.path));
  const worksheets = parserXmlEntries.filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/iu.test(entry.path));
  if (!worksheets.length) invalidWorkbook("Excel 工作簿不包含工作表 XML。");
  if (worksheets.length > COMPETITION_IMPORT_XLSX_MAX_WORKSHEETS) {
    resourceLimit(`Excel 工作表不能超过 ${COMPETITION_IMPORT_XLSX_MAX_WORKSHEETS} 个。`);
  }
  let totalCells = 0;
  let maximumRow = 0;
  let maximumColumn = 0;
  const worksheetPaths = new Set(worksheets.map((entry) => entry.path));
  for (const entry of parserXmlEntries) {
    const content = readEntry(buffer, entry, centralDirectoryOffset);
    if (!worksheetPaths.has(entry.path)) continue;
    const dimensions = inspectWorksheetXml(content);
    totalCells += dimensions.cells;
    maximumRow = Math.max(maximumRow, dimensions.maximumRow);
    maximumColumn = Math.max(maximumColumn, dimensions.maximumColumn);
    if (totalCells > COMPETITION_IMPORT_XLSX_MAX_CELLS) {
      resourceLimit(`Excel 单元格总数不能超过 ${COMPETITION_IMPORT_XLSX_MAX_CELLS} 个。`);
    }
  }

  return {
    zipEntries: entries.length,
    worksheets: worksheets.length,
    compressedEntryBytes: totalCompressedBytes,
    totalUncompressedBytes,
    compressionRatio: Math.round(totalCompressionRatio * 100) / 100,
    totalCells,
    maximumRow,
    maximumColumn,
  };
}
