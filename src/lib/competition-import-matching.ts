export function normalizeImportName(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[\s·•.,，。()（）\-_/]/gu, ""); }
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) { const next = [i + 1]; for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1))); row = next; }
  return row[b.length];
}
export function importNameCandidates(source: string, teams: { id: string; name: string }[]) {
  const left = normalizeImportName(source);
  return teams.map((t) => {
    const right = normalizeImportName(t.name);
    const exact = source === t.name, normalized = left === right;
    const short = Math.min(left.length, right.length) >= 2 && (right.startsWith(left) || left.startsWith(right));
    const similarity = 1 - distance(left, right) / Math.max(1, left.length, right.length);
    return { ...t, explanation: exact ? "名称完全一致" : normalized ? "空格、全半角或标点规范化一致，待确认" : "名称近似，需核对真实身份", rank: exact ? 3 : normalized ? 2 : short ? 1.5 : similarity, reasonable: exact || normalized || short || similarity >= 0.5 };
  }).filter((t) => t.reasonable).sort((a,b) => b.rank-a.rank || a.name.localeCompare(b.name,"zh-CN")).slice(0, 8).map(({ id, name, explanation }) => ({ id, name, explanation }));
}
