"use client";

import { useRouter } from "next/navigation";
import styles from "./competition-data-navigation.module.css";

export function CompetitionSeasonFilter({ seasons, selectedSeason, pathname, anchor, preservedQuery = {} }: {
  seasons: readonly number[];
  selectedSeason: number;
  pathname: string;
  anchor: string;
  preservedQuery?: Record<string, string>;
}) {
  const router = useRouter();
  return <form action={`${pathname}#${anchor}`} className={styles.season}>
    {Object.entries(preservedQuery).map(([name, value]) => <input type="hidden" name={name} value={value} key={name} />)}
    <label htmlFor={`${anchor}-season`}>年份</label>
    <select id={`${anchor}-season`} name="season" value={selectedSeason} onChange={(event) => {
      const query = new URLSearchParams({ ...preservedQuery, season: event.target.value });
      router.push(`${pathname}?${query}#${anchor}`);
    }}>
      {seasons.map((season) => <option key={season} value={season}>{season}</option>)}
    </select>
    <noscript><button type="submit">查看</button></noscript>
  </form>;
}
