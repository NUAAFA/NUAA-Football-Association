"use client";

import { PublicPageError } from "@/components/public-page-error";

export default function NewsError({ retry }: { retry: () => void }) {
  return <PublicPageError retry={retry} />;
}
