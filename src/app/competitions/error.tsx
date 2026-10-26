"use client";

import { PublicPageError } from "@/components/public-page-error";

export default function CompetitionError({ retry }: { retry: () => void }) {
  return <PublicPageError retry={retry} />;
}
