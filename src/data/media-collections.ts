import { getMensCupNewsItem, mensCupGallery, mensIntercollegeCup2026 } from "@/data/mens-intercollege-cup-2026";
import { officialWomensCupNews, womensCupGallery, womensIntercollegeCup2026 } from "@/data/womens-intercollege-cup-2026";
import type { ArchiveGalleryImage } from "@/types";

function selectPhotos(gallery: readonly ArchiveGalleryImage[], sources: readonly string[]) {
  return sources.map((src) => {
    const image = gallery.find((entry) => entry.src === src);
    if (!image) throw new Error(`Selected Media photo is missing from its competition gallery: ${src}`);
    return image;
  });
}

// Editorial discovery order. Photo descriptions and dimensions stay in the competition data.
export const mediaCollections = [
  {
    id: "womens-cup-2026",
    title: womensIntercollegeCup2026.competition.shortName,
    context: `${womensIntercollegeCup2026.competition.campus} · ${womensIntercollegeCup2026.competition.format} · 比赛、颁奖与团队合影`,
    archiveHref: "/competitions/2026-womens-intercollege-cup#media",
    reportHref: officialWomensCupNews[0].href,
    images: selectPhotos(womensCupGallery, [
      "/images/competitions/2026-womens-intercollege-cup/01-match-action-touchline.jpg",
      "/images/competitions/2026-womens-intercollege-cup/03-captains-and-referees.jpg",
      "/images/competitions/2026-womens-intercollege-cup/13-trophy-and-medals.jpg",
      "/images/competitions/2026-womens-intercollege-cup/15-champion-team.jpg",
    ]),
  },
  {
    id: "mens-cup-2026",
    title: mensIntercollegeCup2026.competition.shortName,
    context: `天目湖校区 · ${mensIntercollegeCup2026.competition.formatLabel} · 赛前、决赛与冠军合影`,
    archiveHref: "/competitions/2026-mens-intercollege-cup#media",
    reportHref: getMensCupNewsItem("2026-mens-cup-closing")?.href,
    images: selectPhotos(mensCupGallery, [
      "/images/competitions/2026-mens-intercollege-cup/joint-meeting.jpg",
      "/images/competitions/2026-mens-intercollege-cup/final-action-civil-aviation.jpg",
      "/images/competitions/2026-mens-intercollege-cup/final-huddle-zhihui.jpg",
      "/images/competitions/2026-mens-intercollege-cup/champion-zhihui-team.jpg",
    ]),
  },
] as const;

export type MediaCollectionData = (typeof mediaCollections)[number];
