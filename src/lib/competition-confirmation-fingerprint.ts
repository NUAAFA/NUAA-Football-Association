import { createHash } from "node:crypto";

type MatchFact = { id: string; homeTeamId: string; awayTeamId: string; homeScore: number | null; awayScore: number | null; status: string; resultVersion: number; updatedAt: Date | string };
export function confirmationFingerprints(input: { group: [string, string, string, string, boolean]; members: string[]; matches: MatchFact[] }, rankingId = "") {
  const members = [...input.members].sort();
  const matches = [...input.matches].sort((a, b) => a.id.localeCompare(b.id));
  const facts = matches.map((m) => [m.id, m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, m.status, m.resultVersion]);
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const fingerprint = `v2:${digest({ group: input.group, members, matches: facts })}`;
  const legacyFingerprint = digest({ members, matches: matches.map((m, index) => [...facts[index], m.updatedAt]) });
  return {
    fingerprint, legacyFingerprint,
    qualificationFingerprint: `v2:${createHash("sha256").update(fingerprint + rankingId).digest("hex")}`,
    legacyQualificationFingerprint: createHash("sha256").update(legacyFingerprint + rankingId).digest("hex"),
  };
}
