"""Read-only diagnostics. Requires an explicit database path; never repairs data."""
import argparse
import json
import sqlite3
from pathlib import Path
from urllib.parse import quote

parser = argparse.ArgumentParser()
parser.add_argument("database", help="Explicit SQLite path to inspect in read-only mode")
args = parser.parse_args()
path = Path(args.database).resolve(strict=True)
connection = sqlite3.connect("file:" + quote(str(path)) + "?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
connection.execute("PRAGMA query_only=ON")
queries = {
    "completed_appointments_without_end_facts": """SELECT a.id appointmentId,m.id matchId,a.revision,m.status matchStatus,m.kickoff,
      m.homeScore,m.awayScore FROM RefereeAppointment a JOIN Match m ON m.id=a.matchId
      WHERE a.status='COMPLETED' AND (m.status<>'COMPLETED'
      OR datetime(CASE WHEN typeof(m.kickoff) IN ('integer','real') THEN m.kickoff/1000 ELSE m.kickoff END,
        CASE WHEN typeof(m.kickoff) IN ('integer','real') THEN 'unixepoch' ELSE '+0 seconds' END)>datetime('now')
      OR (m.endAt IS NOT NULL AND datetime(CASE WHEN typeof(m.endAt) IN ('integer','real') THEN m.endAt/1000 ELSE m.endAt END,
        CASE WHEN typeof(m.endAt) IN ('integer','real') THEN 'unixepoch' ELSE '+0 seconds' END)>datetime('now'))
      OR m.homeScore IS NULL OR m.awayScore IS NULL OR m.homeScore<0 OR m.awayScore<0)""",
    "published_version_mismatch": """SELECT a.id appointmentId,a.revision FROM RefereeAppointment a
      WHERE a.status='PUBLISHED' AND NOT EXISTS (SELECT 1 FROM AppointmentVersion v WHERE v.appointmentId=a.id AND v.revision=a.revision AND v.status='PUBLISHED')""",
    "unstructured_matches": "SELECT id matchId,competitionId,stage,round FROM Match WHERE stageId IS NULL",
    "file_relationships": """SELECT p.id contentId,d.officialMediaId FROM ContentPost p JOIN DisciplineDetail d ON d.contentPostId=p.id
      LEFT JOIN MediaAsset a ON a.id=d.officialMediaId WHERE d.officialMediaId IS NOT NULL AND a.id IS NULL""",
}
result = {name: [dict(row) for row in connection.execute(sql)] for name, sql in queries.items()}
result["read_only"] = True
result["repairs_performed"] = 0
print(json.dumps(result, ensure_ascii=False, indent=2))
connection.close()
