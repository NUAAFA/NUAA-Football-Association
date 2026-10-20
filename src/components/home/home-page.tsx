import { AssociationSummary } from "@/components/home/association-summary";
import { CurrentCompetitions } from "@/components/home/current-competitions";
import { Hero } from "@/components/home/hero";
import { MediaPreview } from "@/components/home/media-preview";
import { NextMatchForecast } from "@/components/home/next-match-forecast";
import { NewsMediaSection } from "@/components/home/news-media-section";
import { NoticeQuickLinks } from "@/components/home/notice-quick-links";
import { SiteFooter } from "@/components/layout/site-footer";
import styles from "@/components/home/home-page.module.css";

export function HomePage() {
  return (
    <>
      <main className={styles.home} id="main-content">
        <Hero />
        <NextMatchForecast />
        <NoticeQuickLinks />
        <NewsMediaSection />
        <CurrentCompetitions />
        <MediaPreview />
        <AssociationSummary />
      </main>
      <div id="home-footer">
        <SiteFooter homeCompact />
      </div>
    </>
  );
}
