import { HomePage } from "@/components/home/home-page";
import { SiteHeader } from "@/components/layout/site-header";

export default function Home() {
  return (
    <>
      <SiteHeader fixed overlay />
      <HomePage />
    </>
  );
}
