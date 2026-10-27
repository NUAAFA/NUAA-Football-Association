export type AlbumPhoto = { src: string; alt: string; width: number; height: number };

export type MediaAlbum = {
  id: string;
  title: string;
  competitionKey: string;
  competitionName: string;
  competitionHref: string;
  year: number | null;
  campus: string;
  kind: "报道相册" | "赛事影像";
  publishedAt: string | null;
  dateLabel: string;
  source: string | null;
  reportHref: string | null;
  images: AlbumPhoto[];
  cover: AlbumPhoto;
};
