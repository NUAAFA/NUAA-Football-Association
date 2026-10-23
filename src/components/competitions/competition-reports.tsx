import Link from "next/link";

import { getPublishedCompetitionReports } from "@/lib/competition-report-service";

export async function CompetitionReports({ competitionId }: { competitionId: string }) {
  const reports = await getPublishedCompetitionReports(competitionId);
  return reports.length ? (
    <div className="core-competition-report-list">
      {reports.map((report) => (
        <Link href={report.href} key={report.id}>
          <time dateTime={report.dateTime}>{report.dateLabel}</time>
          <span>{report.category}</span>
          <strong>{report.title}</strong>
        </Link>
      ))}
    </div>
  ) : <p>暂无赛事报道</p>;
}
