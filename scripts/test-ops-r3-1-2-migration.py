"""Apply the exact pre-R3.1.2 history and preserve all existing Match/task facts."""
from pathlib import Path
import sqlite3
import tempfile
root = Path(tempfile.mkdtemp(prefix="nuaafa-r312-migration-"))
db = sqlite3.connect(root / "legacy.db")
db.row_factory = sqlite3.Row
latest = "20261001090000_ops_r3_1_2"
for migration in sorted(Path("prisma/migrations").glob("*/migration.sql")):
    if migration.parent.name < latest:
        db.executescript(migration.read_text())
db.executescript("""
INSERT INTO Competition(id,slug,name,campus,format,status,updatedAt) VALUES('old-c','old-c','旧赛事','隔离','FUTSAL','ONGOING',CURRENT_TIMESTAMP);
INSERT INTO Team(id,competitionId,name) VALUES('old-home','old-c','旧主队'),('old-away','old-c','旧客队');
INSERT INTO CompetitionStage(id,competitionId,name,type,sortOrder) VALUES('old-stage','old-c','小组赛','GROUP',2);
INSERT INTO CompetitionGroup(id,stageId,name,sortOrder) VALUES('old-group','old-stage','H组',7);
INSERT INTO TeamGroupMembership(id,teamId,stageId,groupId) VALUES('old-member1','old-home','old-stage','old-group'),('old-member2','old-away','old-stage','old-group');
INSERT INTO Match(id,slug,competitionId,stage,stageId,groupId,matchNumber,kickoff,endAt,venue,homeTeamId,awayTeamId,status,homeScore,awayScore,resultVersion,resultConfirmedAt,updatedAt) VALUES('old-match','old-match','old-c','小组赛','old-stage','old-group',88,'2025-01-01T10:00:00Z','2025-01-01T11:00:00Z','原场地','old-home','old-away','COMPLETED',3,1,2,'2025-01-01T11:10:00Z',CURRENT_TIMESTAMP);
INSERT INTO Referee(id,publicCode,name,updatedAt) VALUES('old-ref','R312-OLD','旧裁判',CURRENT_TIMESTAMP);
INSERT INTO RefereeAppointment(id,matchId,status,revision,completedAt,updatedAt) VALUES('old-appointment','old-match','COMPLETED',2,'2025-01-01T11:15:00Z',CURRENT_TIMESTAMP);
INSERT INTO AppointmentPosition(id,appointmentId,refereeId,key,label,sortOrder) VALUES('old-position','old-appointment','old-ref','REFEREE','裁判员',0);
INSERT INTO AppointmentVersion(id,appointmentId,revision,status,snapshot) VALUES('old-version','old-appointment',2,'COMPLETED','{"preserve":true}');
""")
tables = ["Match", "RefereeAppointment", "AppointmentPosition", "AppointmentVersion", "TeamGroupMembership"]
before = {t: [dict(r) for r in db.execute(f'SELECT * FROM "{t}" ORDER BY id')] for t in tables}
triggers = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
db.executescript(Path(f"prisma/migrations/{latest}/migration.sql").read_text())
for table in tables:
    assert before[table] == [dict(r) for r in db.execute(f'SELECT * FROM "{table}" ORDER BY id')], table
assert triggers <= {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
assert tuple(db.execute('SELECT id,stageId,name,sortOrder FROM CompetitionGroup').fetchone()) == ('old-group','old-stage','H组',7)
assert db.execute('SELECT createdAt,updatedAt FROM CompetitionGroup').fetchone()[0]
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
print("PASS MIGRATION: legacy schedule, scores, result versions, tasks, memberships unchanged; all triggers and FK integrity preserved")
