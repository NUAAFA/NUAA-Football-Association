import ExistingPage from "@/components/referees/admin/admin-match-detail-page";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

export default async function UnifiedAppointmentDetailPage(props: { params: Promise<{ id: string }> }) {
  await guardUnifiedAdminPage("referees:read", "appointments");
  return ExistingPage({ ...props, appointmentOnly: true });
}
