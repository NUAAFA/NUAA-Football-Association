import { notFound } from "next/navigation";
import { ResourceDocumentForm } from "@/components/admin/resource-document-form";
import { AdminPageHeader } from "@/components/referees/admin/admin-ui";
import { getAdminResource } from "@/lib/resource-library";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";

export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await guardUnifiedAdminPage("content:write", "resources");
  const resource = await getAdminResource((await params).id, actor);
  if (!resource) notFound();
  return <><AdminPageHeader eyebrow="RESOURCE LIBRARY" title="编辑资料" description="更新资料信息或选择新的 PDF；原有文件会保留。" /><ResourceDocumentForm initial={resource} /></>;
}
