function roundName(name: string) {
  const normalized = name.normalize("NFKC").replace(/\s+/g, "");
  const numbers: Record<string, string> = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };
  return normalized.replace(/^第([一二三四五六七八九十])轮$/, (_, n: string) => `第${numbers[n]}轮`);
}
export function logicalRounds<T extends { id: string; stageId: string; groupId: string | null; name: string; sortOrder: number }>(rounds: T[]) {
  const buckets = new Map<string, T[]>();
  for (const round of rounds) {
    const key = `${round.stageId}:${round.sortOrder}:${roundName(round.name)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), round]);
  }
  return [...buckets].flatMap(([key, items]) => {
    // Equal text alone cannot merge two rounds of the same group or a stage-wide round.
    const unambiguous = items.length === 1 || (items.every(i => i.groupId !== null) && new Set(items.map(i => i.groupId)).size === items.length);
    return unambiguous ? [{ key, label: items[0].name, stageId: items[0].stageId, ids: items.map(i => i.id) }] : items.map(i => ({ key: `id:${i.id}`, label: `${i.name}（独立轮次）`, stageId: i.stageId, ids: [i.id] }));
  });
}
