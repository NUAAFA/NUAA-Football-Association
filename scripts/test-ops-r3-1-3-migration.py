from pathlib import Path
import sqlite3
import tempfile
root = Path(tempfile.mkdtemp(prefix="nuaafa-r313-migration-"))
db = sqlite3.connect(root / "history.db")
db.row_factory = sqlite3.Row
latest = "20261001120000_ops_r3_1_3"
for migration in sorted(Path("prisma/migrations").glob("*/migration.sql")):
    if migration.parent.name < latest:
        db.executescript(migration.read_text())
db.executescript("""
INSERT INTO Competition(id,slug,name,campus,format,status,updatedAt) VALUES('c','c','隔离旧事实','隔离','FUTSAL','ONGOING',CURRENT_TIMESTAMP);
INSERT INTO Team(id,competitionId,name) VALUES('home','c','甲'),('away','c','乙');
INSERT INTO Match(id,slug,competitionId,stage,kickoff,venue,homeTeamId,awayTeamId,status,homeScore,awayScore,resultVersion,updatedAt) VALUES('match','match','c','旧阶段','2025-10-01T10:00:00Z','原场地','home','away','COMPLETED',3,1,2,CURRENT_TIMESTAMP);
""")
before = dict(db.execute('SELECT * FROM Match').fetchone())
triggers = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
db.executescript(Path(f"prisma/migrations/{latest}/migration.sql").read_text())
after = dict(db.execute('SELECT * FROM Match').fetchone())
assert after.pop("tentativeDate") is None
assert after.pop("tentativeSchedule") is None
assert before == after
assert triggers <= {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
assert db.execute("PRAGMA foreign_key_check").fetchall() == []
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
print("PASS R313 MIGRATION: exact legacy fields retained; new tentative fields null; all existing triggers and FK integrity preserved")
