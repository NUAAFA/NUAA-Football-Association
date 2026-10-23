import { ResourceDocumentForm } from "@/components/admin/resource-document-form";
import { AdminPageHeader } from "@/components/referees/admin/admin-ui";
import { guardUnifiedAdminPage } from "@/lib/unified-admin-page";
import { resourceCategories } from "@/data/resource-options";

export default async function NewResourcePage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await guardUnifiedAdminPage("content:write", "resources");
  const params = await searchParams;
  const category = resourceCategories.find((option) => option.key === params.category)?.key;
  return <><AdminPageHeader eyebrow="RESOURCE LIBRARY" title="新增资料" description="上传原文件，选择公开栏目，并填写版本和适用范围。" /><ResourceDocumentForm initialCategory={category} /></>;
}
