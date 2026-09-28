"use client";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PublicCompetitionView } from "@/types/competition-center";
export function PublicSchedule({ competitions }: { competitions: PublicCompetitionView[] }) {
  const params = useSearchParams(), pathname = usePathname(), router = useRouter();
  const selected = params.get("competition") ?? "", stage = params.get("stage") ?? "", group = params.get("group") ?? "", round = params.get("round") ?? "", status = params.get("status") ?? "", date = params.get("date") ?? "";
  const all = competitions.filter((c) => !selected || c.id === selected).flatMap((c) => c.matches.map((m) => ({ ...m, competitionId: c.id, competitionName: c.name, href: c.detailHref })));
  const filtered = all.filter((m) => (!stage || m.stage === stage) && (!group || m.group === group) && (!round || m.round === round) && (!status || m.status === status) && (!date || m.dateLabel.replaceAll(".", "-") === date));
  const pages = Math.max(1, Math.ceil(filtered.length / 30)), page = Math.min(pages, Math.max(1, Number(params.get("page") ?? 1) || 1));
  useEffect(() => {
    // A forecast can point to a match beyond the first page of a long season.
    const hash = window.location.hash;
    if (!hash.startsWith("#match-")) return;
    const index = filtered.findIndex((match) => `#match-${match.id}` === hash);
    if (index < 0) return;
    const targetPage = Math.floor(index / 30) + 1;
    if (targetPage !== page) {
      const next = new URLSearchParams(params.toString());
      next.set("page", String(targetPage));
      router.replace(`${pathname}?${next}${hash}`, { scroll: false });
    } else {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
    }
  }, [filtered, page, params, pathname, router]);
  const change = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); if (value) next.set(key, value); else next.delete(key); next.delete("page"); if (key === "competition") { next.delete("stage"); next.delete("group"); next.delete("round"); } if (key === "stage") { next.delete("group"); next.delete("round"); } router.replace(`${pathname}?${next}`); };
  const values = (key: "stage" | "group" | "round") => [...new Set(all.filter((m) => !stage || key === "stage" || m.stage === stage).map((m) => m[key]).filter((v): v is string => Boolean(v)))];
  return <><div className="functional-filters"><label>赛事<select value={selected} onChange={(e) => change("competition", e.target.value)}><option value="">全部赛事</option>{competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{(["stage", "group", "round"] as const).map((key, i) => <label key={key}>{["阶段", "小组", "轮次"][i]}<select value={params.get(key) ?? ""} onChange={(e) => change(key, e.target.value)}><option value="">全部</option>{values(key).map((v) => <option key={v}>{v}</option>)}</select></label>)}<label>状态<select value={status} onChange={(e) => change("status", e.target.value)}><option value="">全部</option><option value="scheduled">已安排</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label><label>日期<input type="date" value={date} onChange={(e) => change("date", e.target.value)} /></label><span>共 {filtered.length} 场 · 北京时间</span></div><div className="functional-schedule-table-wrap ops-public-table"><table className="functional-schedule-table"><thead><tr><th>时间</th><th>赛事 / 阶段 / 组 / 轮次</th><th>主队</th><th>赛果</th><th>客队</th><th>场地</th></tr></thead><tbody>{filtered.slice((page - 1) * 30, page * 30).map((m) => <tr id={`match-${m.id}`} key={m.id}><td>{m.dateLabel} {m.timeLabel}</td><td><Link href={`${m.href}#match-${m.id}`}>{m.competitionName}</Link><small>{[m.stage, m.group, m.round].filter(Boolean).join(" · ")}</small></td><td>{m.homeTeam.name}</td><td>{m.status === "completed" && m.homeScore !== null && m.awayScore !== null ? `${m.homeScore} : ${m.awayScore}` : m.statusLabel}{m.homePenaltyScore !== null && m.homePenaltyScore !== undefined ? <small>点球 {m.homePenaltyScore}:{m.awayPenaltyScore}</small> : null}</td><td>{m.awayTeam.name}</td><td>{m.venue}</td></tr>)}</tbody></table></div>{!filtered.length ? <p>暂无符合条件的公开赛程。</p> : null}<nav className="admin-pagination" aria-label="赛程分页">{page > 1 ? <Link href={`?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page - 1) })}`}>上一页</Link> : null}<span>{page} / {pages}</span>{page < pages ? <Link href={`?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page + 1) })}`}>下一页</Link> : null}</nav></>;
}
