import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

const baseRevision = process.env.UNICODE_BASE ?? "origin/main";
const gitBinary = process.env.GIT_BINARY ?? "git";
const diff = spawnSync(
  gitBinary,
  ["diff", "--name-only", "--diff-filter=ACMR", baseRevision, "--"],
  { encoding: "utf8" },
);

if (diff.status !== 0) {
  process.stderr.write(
    diff.stderr || diff.error?.message || "Unable to list changed files.\n",
  );
  process.exit(diff.status ?? 1);
}

const files = diff.stdout
  .split(/\r?\n/u)
  .map((file) => file.trim())
  .filter(Boolean);

const binaryExtensions = new Set([
  ".avif",
  ".docx",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".pptx",
  ".webp",
  ".woff",
  ".woff2",
  ".xlsx",
  ".zip",
]);

const decoder = new TextDecoder("utf-8", { fatal: true });
const findings = [];
// Only this reviewed archive is binary; any replacement needs a new review.
const verifiedBinaryFiles = new Map([
  [
    "vendor/next-default-root-glob/next-default-root-glob-1.0.0.tgz",
    "8a6127cb43588a0069625c5df5a1e1662dc642f59dc669127c324e64d41a6a19",
  ],
]);

function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function hasExtension(file, extensions) {
  const lowerFile = file.toLowerCase();
  return [...extensions].some((extension) => lowerFile.endsWith(extension));
}

function record(file, line, column, codePoint, category) {
  findings.push({ file, line, column, codePoint, category });
}

for (const file of files) {
  const expectedDigest = verifiedBinaryFiles.get(file);
  if (expectedDigest) {
    if (!lstatSync(file).isFile()) {
      record(file, 0, 0, "INVALID_BINARY_FILE_TYPE", "unverified archive");
    } else if (
      createHash("sha256").update(readFileSync(file)).digest("hex") !== expectedDigest
    ) {
      record(file, 0, 0, "BINARY_SHA256_MISMATCH", "unverified archive");
    }
    continue;
  }
  if (hasExtension(file, binaryExtensions)) {
    continue;
  }

  const bytes = readFileSync(file);
  const hasUtf8Bom =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf;
  const hasUtf16Bom =
    bytes.length >= 2 &&
    ((bytes[0] === 0xfe && bytes[1] === 0xff) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe));

  if (hasUtf8Bom || hasUtf16Bom) {
    record(file, 1, 1, "U+FEFF", "byte-order mark");
  }

  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    record(file, 0, 0, "INVALID_UTF8", "encoding");
    continue;
  }

  let line = 1;
  let column = 1;

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    const isRequiredWhitespace =
      codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    const isRequestedRange =
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      codePoint === 0xfeff;
    const isOtherControl =
      /[\p{Cc}\p{Cf}]/u.test(character) && !isRequiredWhitespace;
    const isInvisibleSeparator =
      /[\p{Zl}\p{Zp}]/u.test(character) ||
      (/\p{Zs}/u.test(character) && codePoint !== 0x20);
    const isVariationSelector =
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
      (codePoint >= 0xe0100 && codePoint <= 0xe01ef);

    if (
      isRequestedRange ||
      isOtherControl ||
      isInvisibleSeparator ||
      isVariationSelector
    ) {
      record(
        file,
        line,
        column,
        formatCodePoint(codePoint),
        "hidden Unicode",
      );
    }

    if (codePoint === 0x0a) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    process.stderr.write(
      `${finding.file}:${finding.line}:${finding.column} ${finding.codePoint} ${finding.category}\n`,
    );
  }
  process.stderr.write(`Found ${findings.length} unsafe Unicode character(s).\n`);
  process.exit(1);
}

process.stdout.write(
  `Unicode safety check passed for ${files.length} changed text file(s).\n`,
);
