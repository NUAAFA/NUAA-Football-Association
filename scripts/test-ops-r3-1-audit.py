"""Exercise read-only diagnostics against a disposable SQLite fixture."""
import datetime
import json
import sqlite3
import subprocess
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory(prefix="nuaafa-ops-audit-") as directory:
    database = Path(directory) / "audit.db"
    connection = sqlite3.connect(database)
    connection.executescript("""
      CREATE TABLE Match(id TEXT,competitionId TEXT,stage TEXT,round TEXT,stageId TEXT,status TEXT,kickoff,endAt,homeScore INTEGER,awayScore INTEGER);
      CREATE TABLE RefereeAppointment(id TEXT,matchId TEXT,status TEXT,revision INTEGER);
      CREATE TABLE AppointmentVersion(id TEXT,appointmentId TEXT,revision INTEGER,status TEXT);
      CREATE TABLE ContentPost(id TEXT);
      CREATE TABLE DisciplineDetail(contentPostId TEXT,officialMediaId TEXT);
      CREATE TABLE MediaAsset(id TEXT);
    """)
    tomorrow = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
    for index, kickoff in enumerate([int(tomorrow.timestamp() * 1000), tomorrow.isoformat()]):
        connection.execute("INSERT INTO Match VALUES(?, 'fixture','old',NULL,NULL,'COMPLETED',?,NULL,0,0)", (str(index), kickoff))
        connection.execute("INSERT INTO RefereeAppointment VALUES(?,?,'COMPLETED',1)", (str(index), str(index)))
    connection.commit()
    connection.close()
    before = database.read_bytes()
    result = subprocess.run(["python3", "scripts/audit-ops-r3-1.py", str(database)], capture_output=True, text=True, check=True)
    report = json.loads(result.stdout)
    assert len(report["completed_appointments_without_end_facts"]) == 2
    assert report["read_only"] and report["repairs_performed"] == 0
    assert before == database.read_bytes()
    print("PASS read-only audit: integer/ISO future dates detected; database unchanged")
