"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Revalidate derived Beijing-day data at midnight and after returning to a suspended tab. */
export function BeijingDayRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function schedule() { const local = Date.now() + 8 * 3600000; const delay = 86400000 - (local % 86400000) + 250; timer = setTimeout(() => { router.refresh(); schedule(); }, delay); }
    function resume() { if (document.visibilityState === "visible") router.refresh(); }
    schedule(); document.addEventListener("visibilitychange", resume);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [router]);
  return null;
}
