"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { comparePublicMatches, publicMatchProgress } from "@/lib/competition-presentation";
import type { PublicCompetitionView } from "@/types/competition-center";
import styles from "./public-schedule.module.css";

const previewSize = 3;
const pageSize = 6;

export function PublicSchedule({ competitions, referenceTime }: { competitions: PublicCompetitionView[]; referenceTime: number }) {
  const params = useSearchParams(), pathname = usePathname(), router = useRouter();
  const selected = params.get("competition") ?? "", stage = params.get("stage") ?? "", group = params.get("group") ?? "", round = params.get("round") ?? "", status = params.get("status") ?? "", date = params.get("date") ?? "";
  const expanded = params.get("view") === "all" || params.has("page");
  const all = useMemo(() => competitions.filter((c) => !selected || c.id === selected)
    .flatMap((c) => c.matches.map((m) => ({ ...m, competitionName: c.name, href: c.detailHref })))
    .sort((a, b) => comparePublicMatches(a, b, referenceTime)), [competitions, selected, referenceTime]);
  const filtered = useMemo(() => all.filter((m) => (!stage || m.stage === stage)
    && (!group || m.group === group) && (!round || m.round === round)
    && (!status || (status === "pending" ? m.status === "scheduled" && !m.kickoff
      : status === "scheduled" ? m.status === "scheduled" && Boolean(m.kickoff) : m.status === status))
    && (!date || m.dateLabel.replaceAll(".", "-") === date)), [all, stage, group, round, status, date]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Number(params.get("page") ?? 1);
  const page = Number.isFinite(requestedPage) ? Math.min(pages, Math.max(1, Math.floor(requestedPage))) : 1;
  const start = expanded ? (page - 1) * pageSize : 0;
  const visible = filtered.slice(start, start + (expanded ? pageSize : previewSize));
  const sectionId = pathname === "/competitions/schedule" ? "published-matches" : "schedule";

  useEffect(() => {
    function revealLinkedMatch() {
      const hash = window.location.hash;
      if (!hash.startsWith("#match-")) return;
      const index = filtered.findIndex((match) => `#match-${match.id}` === hash);
      if (index < 0) return;
      const targetPage = Math.floor(index / pageSize) + 1;
      if ((!expanded && index >= previewSize) || (expanded && targetPage !== page)) {
        const next = new URLSearchParams(params.toString());
        next.set("view", "all");
        next.set("page", String(targetPage));
        router.replace(`${pathname}?${next}${hash}`, { scroll: false });
      } else document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
    }
    revealLinkedMatch();
    window.addEventListener("hashchange", revealLinkedMatch);
    return () => window.removeEventListener("hashchange", revealLinkedMatch);
  }, [filtered, expanded, page, params, pathname, router]);

  function change(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    if (key === "competition") { next.delete("stage"); next.delete("group"); next.delete("round"); }
    if (key === "stage") { next.delete("group"); next.delete("round"); }
    if (key === "group") next.delete("round");
    router.replace(`${pathname}?${next}#${sectionId}`, { scroll: false });
  }
  function pageHref(target: number) {
    const next = new URLSearchParams(params.toString());
    next.set("view", "all");
    next.set("page", String(target));
    return `${pathname}?${next}#${sectionId}`;
  }
  const values = (key: "stage" | "group" | "round") => [...new Set(all
    .filter((m) => (!stage || key === "stage" || m.stage === stage) && (!group || key !== "round" || m.group === group))
    .map((m) => m[key]).filter((v): v is string => Boolean(v)))];
  const hasFilters = Boolean(selected || stage || group || round || status || date);

  return <div className={styles.schedule}>
    <details className={styles.filterDisclosure} open={hasFilters || undefined}>
      <summary aria-label="筛选比赛"><span className={styles.resultCount} aria-live="polite"><strong>共 {filtered.length} 场{visible.length ? ` · 当前 ${start + 1}–${start + visible.length} 场` : ""}</strong><small>按开赛时间 · 北京时间（UTC+8）</small></span><span className={styles.filterAction}>筛选比赛{hasFilters ? " · 已筛选" : ""}<span aria-hidden="true">＋</span></span></summary>
      <div className={styles.filters} role="group" aria-label="赛程筛选">
      {competitions.length > 1 ? <label><span>赛事</span><select aria-label="赛事" value={selected} onChange={(e) => change("competition", e.target.value)}><option value="">全部赛事</option>{competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : null}
      {(["stage", "group", "round"] as const).map((key, i) => <label key={key}><span>{["阶段", "小组", "轮次"][i]}</span><select aria-label={["阶段", "小组", "轮次"][i]} value={params.get(key) ?? ""} onChange={(e) => change(key, e.target.value)}><option value="">全部{["阶段", "小组", "轮次"][i]}</option>{values(key).map((v) => <option key={v}>{v}</option>)}</select></label>)}
      <label><span>比赛状态</span><select aria-label="比赛状态" value={status} onChange={(e) => change("status", e.target.value)}><option value="">全部状态</option><option value="scheduled">已定时间</option><option value="pending">待排期</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
      <label><span>比赛日期</span><input aria-label="比赛日期" type="date" value={date} onChange={(e) => change("date", e.target.value)} /></label>
      {hasFilters ? <Link className={styles.reset} href={`${pathname}#${sectionId}`} scroll={false}>清除筛选</Link> : null}
    </div>
    </details>
    <ul className={styles.matches} aria-label="公开赛程">
      {visible.map((m) => <li id={`match-${m.id}`} className={styles.match} key={m.id}>
        <div className={styles.time}>{m.kickoff ? <time dateTime={new Date(m.kickoff).toISOString()}><span>{m.dateLabel}</span><strong>{m.timeLabel}</strong></time> : <strong>时间待定</strong>}<span className={styles.progress} data-status={m.status}>{publicMatchProgress(m, referenceTime)}</span></div>
        <div className={styles.matchBody}>
          <Link className={styles.competition} href={`${m.href}#match-${m.id}`}>{m.competitionName}</Link>
          <p className={styles.round}>{[m.stage, m.group, m.round, m.matchNumber ? `第${m.matchNumber}场` : null].filter(Boolean).join(" · ")}</p>
          <div className={styles.matchup}><strong>{m.homeTeam.name}</strong><span className={styles.score}>{m.status === "completed" && m.homeScore !== null && m.awayScore !== null ? `${m.homeScore} : ${m.awayScore}` : "VS"}{m.homePenaltyScore != null ? <small>点球 {m.homePenaltyScore} : {m.awayPenaltyScore}</small> : null}</span><strong>{m.awayTeam.name}</strong></div>
        </div>
        <div className={styles.venue}><span>比赛场地</span><strong>{m.venue}</strong>{m.appointment?.positions.length ? <Link href={`${m.href}#officials`}>查看裁判选派 →</Link> : null}</div>
      </li>)}
    </ul>
    {!filtered.length ? <div className={styles.empty}><strong>暂无符合条件的公开赛程</strong><p>请调整筛选条件后重试。</p></div> : null}
    {!expanded && filtered.length > previewSize ? <div className={styles.more}><p>默认展示三场比赛</p><Link className="ui-button ui-button-secondary" href={pageHref(1)} scroll={false}>展示更多比赛（共 {filtered.length} 场） <span aria-hidden="true">↓</span></Link><small>展开后每页 6 场，可翻页浏览</small></div> : null}
    {expanded && filtered.length > 0 ? <nav className={styles.pagination} aria-label="赛程分页">{page > 1 ? <Link href={pageHref(page - 1)} scroll={false}>上一页</Link> : <span aria-disabled="true">上一页</span>}<span aria-live="polite">第 {page} / {pages} 页 · 每页 6 场</span>{page < pages ? <Link href={pageHref(page + 1)} scroll={false}>下一页</Link> : <span aria-disabled="true">下一页</span>}<Link className={styles.collapse} href={`${pathname}?${new URLSearchParams([...params].filter(([key]) => key !== "page" && key !== "view"))}#${sectionId}`} scroll={false}>收起为三场</Link></nav> : null}
  </div>;
}
