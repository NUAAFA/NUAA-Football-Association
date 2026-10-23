export const refereeContinuationSize = 12;

export type RefereeListKind = "assignments" | "history" | "open-matches";

export type PublicRefereeListItem = {
  id: string;
  competition: string;
  format: string;
  match: string;
  kickoff: string | null;
  venue: string;
  stage: string;
  href: string;
  badge: string;
  positions: { key: string; label: string; referee: string }[];
  publishedAt?: string | null;
  updatedAt?: string;
  note?: string | null;
  deadline?: string | null;
  demand?: number;
};

export type PublicRefereeListBatch = {
  items: PublicRefereeListItem[];
  total: number;
  nextCursor: string | null;
};
