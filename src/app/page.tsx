import { HomePage } from "@/components/home/home-page";
import { SiteHeader } from "@/components/layout/site-header";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <SiteHeader fixed overlay />
      <HomePage />
    </>
  );
}
