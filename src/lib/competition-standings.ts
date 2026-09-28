export type StandingTeam = { id: string; name: string };
export type StandingMatch = { homeTeamId: string; awayTeamId: string; homeScore: number | null; awayScore: number | null; status: string; isTestData: boolean };
export function calculateStandings(teams: readonly StandingTeam[], matches: readonly StandingMatch[]) {
  const rows = new Map(teams.map((t) => [t.id, { ...t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0 }]));
  for (const m of matches) {
    if (m.status !== "COMPLETED" || m.isTestData || m.homeScore === null || m.awayScore === null || !Number.isSafeInteger(m.homeScore) || !Number.isSafeInteger(m.awayScore) || m.homeScore < 0 || m.awayScore < 0 || m.homeTeamId === m.awayTeamId) continue;
    const home = rows.get(m.homeTeamId), away = rows.get(m.awayTeamId);
    if (!home || !away) continue;
    home.played++; away.played++; home.goalsFor += m.homeScore; home.goalsAgainst += m.awayScore; away.goalsFor += m.awayScore; away.goalsAgainst += m.homeScore;
    if (m.homeScore > m.awayScore) { home.won++; away.lost++; home.points += 3; }
    else if (m.homeScore < m.awayScore) { away.won++; home.lost++; away.points += 3; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }
  return [...rows.values()].map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst })).sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.id.localeCompare(b.id));
}
