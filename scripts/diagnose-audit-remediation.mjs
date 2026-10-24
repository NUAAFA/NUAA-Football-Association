import { DatabaseSync } from 'node:sqlite';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { confirmationFingerprints } from '../src/lib/competition-confirmation-fingerprint.ts';

// Deliberately has no apply mode, dotenv, environment fallback, or Prisma writer.
const argument = process.argv.find(value => value.startsWith('--database='));
if (!argument) throw new Error('Use node --import tsx scripts/diagnose-audit-remediation.mjs --database=/absolute/path/to/database.db (read only).');
const target = path.resolve(argument.slice('--database='.length));
if (target !== realpathSync(target) || !statSync(target).isFile()) throw new Error('An existing regular database with no symbolic-link path is required.');
const db = new DatabaseSync(target, { readOnly: true });
try {
  db.exec('PRAGMA query_only = ON');
  const time = value => value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
  const groups = db.prepare('SELECT g.id,g.stageId,s.competitionId,s.type,c.isTestData FROM CompetitionGroup g JOIN CompetitionStage s ON s.id=g.stageId JOIN Competition c ON c.id=s.competitionId').all();
  const confirmations = groups.map(group => {
    const members = db.prepare('SELECT teamId FROM TeamGroupMembership WHERE groupId=? ORDER BY teamId').all(group.id).map(row => row.teamId);
    const ids = new Set(members);
    const matches = db.prepare('SELECT * FROM Match WHERE groupId=? ORDER BY id').all(group.id).filter(m => !m.isTestData && m.stageId === group.stageId && m.competitionId === group.competitionId && m.homeTeamId !== m.awayTeamId && ids.has(m.homeTeamId) && ids.has(m.awayTeamId)).map(m => ({ ...m, updatedAt: time(m.updatedAt) }));
    const records = db.prepare('SELECT * FROM GroupConfirmation WHERE groupId=?').all(group.id).sort((a,b) => time(b.createdAt)-time(a.createdAt) || b.id.localeCompare(a.id));
    const ranking = records.find(r => ['RANKING','AUTO'].includes(r.kind));
    const qualification = records.find(r => r.kind === 'QUALIFICATION');
    const f = confirmationFingerprints({ group: [group.id,group.stageId,group.competitionId,group.type,Boolean(group.isTestData)], members, matches }, ranking?.id ?? '');
    const legacyProofEligible = group.type === "GROUP" && !group.isTestData;
    const classify = (record, current, legacy) => !record ? { status: 'NONE' } : { id: record.id, status: record.fingerprint === current ? 'V2_VALID' : legacyProofEligible && record.fingerprint === legacy ? 'LEGACY_VALID' : record.fingerprint.startsWith('v2:') ? 'V2_STALE' : 'LEGACY_UNVERIFIED', wouldPromoteOnVerifiedMatchEdit: legacyProofEligible && record.fingerprint === legacy, reason: (record.fingerprint === current || (legacyProofEligible && record.fingerprint === legacy)) ? 'Current facts prove this confirmation.' : 'Current facts cannot prove this record; retain it for review.' };
    return { groupId: group.id, ranking: classify(ranking,f.fingerprint,f.legacyFingerprint), qualification: classify(qualification,f.qualificationFingerprint,f.legacyQualificationFingerprint) };
  });
  const applications = db.prepare(`SELECT a.id,a.matchId,a.refereeId,a.status,
    EXISTS(SELECT 1 FROM RefereeAppointment r JOIN AppointmentPosition p ON p.appointmentId=r.id JOIN Match m ON m.id=r.matchId
      WHERE r.matchId=a.matchId AND p.refereeId=a.refereeId AND r.status IN ('PUBLISHED','COMPLETED') AND m.status!='CANCELLED') AS official
    FROM RefereeApplication a`).all().filter(row => Boolean(row.official) !== (row.status === 'APPOINTED')).map(row => ({ id: row.id, matchId: row.matchId, refereeId: row.refereeId, storedStatus: row.status, officialTask: Boolean(row.official), reason: row.official ? 'An official task exists; task-derived display must win.' : 'No current official task; retain legacy record for review.' }));
  console.log(JSON.stringify({ readOnly: true, schemaChanges: false, confirmations, applicationMismatches: applications }, null, 2));
} finally { db.close(); }
