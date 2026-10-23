"use client";

import { useEffect, useRef, useState } from "react";
import { PublicAppointmentList } from "@/components/referees/mvp/public-appointment-list";
import type { RefereeListFilters } from "@/lib/referee-list-filters";
import { refereeContinuationSize, type PublicRefereeListBatch, type RefereeListKind } from "@/types/referee-public-list";
import styles from "./referee-list-browser.module.css";

export function ProgressiveRefereeList({ initial, kind, filters }: { initial: PublicRefereeListBatch; kind: RefereeListKind; filters: RefereeListFilters }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);

  const browseAll = async () => {
    if (busy.current || !data.nextCursor) return;
    busy.current = true;
    setLoading(true);
    setError("");
    controller.current = new AbortController();
    try {
      let cursor: string | null = data.nextCursor;
      const visited = new Set<string>();
      while (cursor && alive.current) {
        if (visited.has(cursor)) throw new Error();
        visited.add(cursor);
        const params = new URLSearchParams({ kind, after: cursor });
        for (const key of ["competition", "format", "from", "to", "q"] as const) if (filters[key]) params.set(key, filters[key]);
        const response = await fetch(`/api/referees/public-list?${params}`, { cache: "no-store", signal: controller.current.signal });
        if (!response.ok) throw new Error();
        const batch = await response.json() as PublicRefereeListBatch;
        if (!Array.isArray(batch.items) || batch.items.length > refereeContinuationSize || (batch.nextCursor !== null && typeof batch.nextCursor !== "string")) throw new Error();
        if (!alive.current) return;
        setData((previous) => {
          const seen = new Set(previous.items.map((item) => item.id));
          return { ...batch, items: [...previous.items, ...batch.items.filter((item) => !seen.has(item.id))] };
        });
        cursor = batch.nextCursor;
      }
    } catch {
      if (alive.current && !controller.current.signal.aborted) setError("加载失败，请点击重试。");
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  };

  return <div className={styles.progressive}>
    <PublicAppointmentList items={data.items} emptyTitle="当前条件下暂无公开场次" />
    {data.items.length ? <div className={styles.loadMore}>
      <p role="status" aria-live="polite">{loading ? "正在展开全部比赛…" : error ? "部分比赛尚未展开，请重试" : !data.nextCursor ? "已显示全部比赛，可向下浏览" : "默认显示最近三场比赛"}</p>
      {error ? <p role="alert">{error}</p> : null}
      {data.nextCursor ? <button type="button" onClick={() => void browseAll()} disabled={loading}>{loading ? "正在展开…" : error ? "重试加载" : "继续浏览"}</button> : null}
    </div> : null}
  </div>;
}
