import type { Metadata } from "next";

import { AssociationPageContent } from "@/components/association/association-page-content";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  alternates: { canonical: "/association" },
  title: "协会",
  description: "南京航空航天大学天目湖足球协会公开档案。",
  openGraph: {
    title: "关于南京航空航天大学天目湖足球协会",
    description: "协会身份、现任足协成员、历届成员、服务范围与公开联系方式。",
    url: "/association",
  },
};

export default function AssociationPage() {
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <AssociationPageContent />
    </>
  );
}
