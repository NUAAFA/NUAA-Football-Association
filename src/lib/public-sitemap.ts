import type { MetadataRoute } from "next";
import { getPublicDiscoveryItems } from "@/lib/public-content-discovery";
import { getPublicCompetitionCatalog } from "@/lib/public-competition-service";
import { absoluteSiteUrl } from "@/lib/site-metadata";

const publicRoutes = [
  "/",
  "/association",
  "/competitions",
  "/competitions/2026-mens-intercollege-cup",
  "/competitions/2026-womens-intercollege-cup",
  "/competitions/arbitration",
  "/competitions/files",
  "/competitions/history",
  "/competitions/schedule",
  "/competitions/scorers",
  "/competitions/standings",
  "/join",
  "/media",
  "/news",
  "/participation",
  "/participation/event-guide",
  "/participation/join-association",
  "/participation/join-media",
  "/participation/team-manager-guide",
  "/referees",
  "/referees/assignments",
  "/referees/directory",
  "/referees/history",
  "/referees/open-matches",
  "/referees/recruitment",
  "/referees/resources/competition-rules",
  "/referees/resources/training",
  "/referees/resources/work-files",
  "/teams",
] as const;

export async function getPublicSitemap(): Promise<MetadataRoute.Sitemap> {
  // Either source failing rejects the whole feed; incomplete success is never cached.
  const [competitions, stories] = await Promise.all([getPublicCompetitionCatalog(), getPublicDiscoveryItems()]);
  const staticEntries: MetadataRoute.Sitemap = publicRoutes.map((pathname) => ({
    url: absoluteSiteUrl(pathname),
    changeFrequency: pathname === "/" || pathname === "/news" ? "weekly" : "monthly",
    priority: pathname === "/" ? 1 : pathname.split("/").length === 2 ? 0.8 : 0.6,
  }));
  const newsEntries: MetadataRoute.Sitemap = stories.map((story) => ({
    url: absoluteSiteUrl(story.href), lastModified: story.updatedAt,
    changeFrequency: "yearly", priority: 0.7,
  }));
  const competitionEntries: MetadataRoute.Sitemap = competitions.map((competition) => ({
    url: absoluteSiteUrl(competition.detailHref), changeFrequency: "weekly", priority: 0.8,
  }));
  return [...new Map([...staticEntries, ...competitionEntries, ...newsEntries].map((entry) => [entry.url, entry])).values()];
}
