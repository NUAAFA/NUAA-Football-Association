import AdminMatchDetailPage from "@/components/referees/admin/admin-match-detail-page";

export default async function RefereeMatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return AdminMatchDetailPage({ params });
}
