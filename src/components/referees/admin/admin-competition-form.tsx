"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  competitionFormatLabels,
  competitionStatusLabels,
  dataSourceLabels,
} from "@/components/referees/admin/admin-ui";

export type AdminCompetitionRecord = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  year: number | null;
  campus: string;
  format: "ELEVEN_A_SIDE" | "FUTSAL" | "CUSTOM";
  playingFormat: string;
  status: "PREPARING" | "REGISTRATION" | "ONGOING" | "COMPLETED";
  semesterLabel: string;
  teamFormation: string;
  publicPublished: boolean;
  homepageFeatured: boolean;
  publicOrder: number;
  registrationStartAt: string;
  registrationEndAt: string;
  matchStartAt: string;
  matchEndAt: string;
  venue: string;
  host: string;
  organizer: string;
  summary: string;
  notice: string;
  registrationUrl: string;
  source: "MANUAL" | "FOOTBALL_CHINA";
  externalCompetitionId: string;
  lastSyncedAt: string;
};

export function AdminCompetitionForm({ competition }: { competition?: AdminCompetitionRecord }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publicPublished, setPublicPublished] = useState(competition?.publicPublished ?? false);
  const [homepageFeatured, setHomepageFeatured] = useState(
    Boolean(competition?.publicPublished && competition.homepageFeatured),
  );

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  function cancel() {
    if (dirty && !window.confirm("当前赛事资料有未保存修改，确认离开吗？")) return;
    router.back();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const yearText = String(form.get("year") ?? "").trim();
    const payload = {
      ...(!competition ? { slug: form.get("slug") } : {}),
      name: form.get("name"),
      shortName: form.get("shortName"),
      year: yearText ? Number(yearText) : null,
      campus: form.get("campus"),
      format: form.get("format"),
      playingFormat: form.get("playingFormat"),
      status: form.get("status"),
      semesterLabel: form.get("semesterLabel"),
      teamFormation: form.get("teamFormation"),
      publicPublished: form.get("publicPublished") === "on",
      homepageFeatured: form.get("homepageFeatured") === "on",
      publicOrder: Number(form.get("publicOrder") ?? 0),
      registrationStartAt: form.get("registrationStartAt"),
      registrationEndAt: form.get("registrationEndAt"),
      matchStartAt: form.get("matchStartAt"),
      matchEndAt: form.get("matchEndAt"),
      venue: form.get("venue"),
      host: form.get("host"),
      organizer: form.get("organizer"),
      summary: form.get("summary"),
      notice: form.get("notice"),
      registrationUrl: form.get("registrationUrl"),
    };
    const response = await fetch(
      competition ? `/api/referees/admin/competitions/${competition.id}` : "/api/referees/admin/competitions",
      {
        method: competition ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "赛事保存失败。");
      setSubmitting(false);
      return;
    }
    setDirty(false);
    router.push("/admin/competitions");
    router.refresh();
  }

  return <form className="admin-form admin-competition-form" onChange={() => setDirty(true)} onSubmit={submit}>
    <section className="admin-form-section">
      <header><h2>基础资料</h2><p>页面地址标识用于生成稳定链接，创建后不可通过普通编辑修改。</p></header>
      <div className="admin-form-grid admin-competition-basics-grid">
        <label>
          <span>页面地址标识</span>
          {competition
            ? <input aria-readonly="true" readOnly value={competition.slug} />
            : <input maxLength={80} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="campus-seven-a-side" required />}
        </label>
        <label><span>赛事名称</span><input defaultValue={competition?.name} maxLength={120} name="name" placeholder="例如：2026 新生杯" required /></label>
        <p className="admin-competition-slug-help">用于生成赛事固定网址，仅支持小写英文字母、数字和连字符；创建后不建议修改。</p>
        <label><span>赛事简称</span><input defaultValue={competition?.shortName} maxLength={60} name="shortName" placeholder="例如：新生杯" /></label>
        <label><span>赛季年份</span><input defaultValue={competition?.year ?? ""} max={2200} min={1900} name="year" placeholder="2026" type="number" /></label>
        <label><span>校区</span><input defaultValue={competition?.campus ?? "天目湖校区"} maxLength={60} name="campus" required /></label>
        <label><span>比赛制式</span><input defaultValue={competition?.playingFormat ?? ""} list="competition-playing-formats" maxLength={40} name="playingFormat" placeholder="例如：七人制" required /><datalist id="competition-playing-formats"><option value="十一人制" /><option value="五人制" /><option value="六人制" /><option value="七人制" /><option value="八人制" /><option value="九人制" /></datalist><small>用于官网展示，可输入未来其他有效制式。</small></label>
        <label><span>裁判岗位模板</span><select defaultValue={competition?.format ?? "ELEVEN_A_SIDE"} name="format">{Object.entries(competitionFormatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>仅控制裁判岗位与能力校验，不会改变官网比赛制式。</small></label>
        <label><span>赛事状态</span><select defaultValue={competition?.status ?? "PREPARING"} name="status">{Object.entries(competitionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>学期</span><select defaultValue={competition?.semesterLabel ?? ""} name="semesterLabel"><option value="">待确认</option><option value="上半学期">上半学期</option><option value="下半学期">下半学期</option></select></label>
        <label><span>组队方式</span><input defaultValue={competition?.teamFormation} maxLength={60} name="teamFormation" placeholder="院系组队 / 自由组队" /></label>
      </div>
    </section>

    <section className="admin-form-section">
      <header><h2>公开状态</h2><p>“公开发布”开启后，该赛事将进入官网公开目录与通用赛事详情页。</p></header>
      <div className="admin-checkbox-list">
        <label>
          <input
            checked={publicPublished}
            name="publicPublished"
            onChange={(event) => {
              setPublicPublished(event.target.checked);
              if (!event.target.checked) setHomepageFeatured(false);
            }}
            type="checkbox"
          />
          <span>公开发布</span>
        </label>
        <label className={!publicPublished ? "is-disabled" : undefined}>
          <input
            aria-describedby="homepage-feature-help"
            checked={homepageFeatured}
            disabled={!publicPublished}
            name="homepageFeatured"
            onChange={(event) => setHomepageFeatured(event.target.checked)}
            type="checkbox"
          />
          <span className="admin-competition-feature-copy">
            <strong>首页赛事预告候选</strong>
            <small id="homepage-feature-help">
              官网最多展示 2 个赛事，每个赛事显示最近 1 场；系统优先展示近期比赛。勾选候选不保证当前一定占首页。
              {!publicPublished ? " 请先开启“公开发布”后再设置首页展示。" : ""}
            </small>
          </span>
        </label>
      </div>
      <details><summary>高级设置 · 目录与候选次级排序</summary><div className="admin-form-grid">
        <label><span>高级排序（目录及同时开球 / 空态候选）</span><input defaultValue={competition?.publicOrder ?? 0} max={1000} min={-1000} name="publicOrder" required type="number" /></label>
      </div></details>
    </section>

    <section className="admin-form-section">
      <header><h2>报名信息</h2><p>以下日期时间一律按北京时间（UTC+8）保存，不使用浏览器所在时区。</p></header>
      <div className="admin-form-grid">
        <label><span>报名开始时间 · 北京时间（UTC+8）</span><input defaultValue={competition?.registrationStartAt} name="registrationStartAt" type="datetime-local" /></label>
        <label><span>报名截止时间 · 北京时间（UTC+8）</span><input defaultValue={competition?.registrationEndAt} name="registrationEndAt" type="datetime-local" /></label>
        <label className="admin-form-span-2"><span>报名入口 URL</span><input defaultValue={competition?.registrationUrl} inputMode="url" maxLength={500} name="registrationUrl" placeholder="https://... 或 /站内路径" type="text" /></label>
      </div>
    </section>

    <section className="admin-form-section">
      <header><h2>比赛信息</h2><p>以下日期时间一律按北京时间（UTC+8）保存。</p></header>
      <div className="admin-form-grid">
        <label><span>比赛开始时间 · 北京时间（UTC+8）</span><input defaultValue={competition?.matchStartAt} name="matchStartAt" type="datetime-local" /></label>
        <label><span>比赛结束时间 · 北京时间（UTC+8）</span><input defaultValue={competition?.matchEndAt} name="matchEndAt" type="datetime-local" /></label>
        <label className="admin-form-span-2"><span>比赛场地</span><input defaultValue={competition?.venue} maxLength={120} name="venue" /></label>
      </div>
    </section>

    <section className="admin-form-section">
      <header><h2>赛事公开资料</h2><p>这些内容仅在赛事明确公开发布后向公众展示。</p></header>
      <div className="admin-form-grid">
        <label><span>主办单位</span><input defaultValue={competition?.host} maxLength={240} name="host" /></label>
        <label><span>承办单位</span><input defaultValue={competition?.organizer} maxLength={240} name="organizer" /></label>
        <label className="admin-form-span-2"><span>赛事简介</span><textarea defaultValue={competition?.summary} maxLength={2000} name="summary" rows={5} /></label>
        <label className="admin-form-span-2"><span>赛事公告/说明</span><textarea defaultValue={competition?.notice} maxLength={4000} name="notice" rows={6} /></label>
      </div>
    </section>

    <div className="admin-form-readonly">
      <div><span>数据来源</span><strong>{dataSourceLabels[competition?.source ?? "MANUAL"]}</strong></div>
      {competition?.externalCompetitionId ? <div><span>外部赛事 ID</span><strong>{competition.externalCompetitionId}</strong></div> : null}
      {competition?.lastSyncedAt ? <div><span>最近同步</span><strong>{competition.lastSyncedAt}</strong></div> : null}
      <p>手工新建赛事固定使用“手工维护”；现有足球中国同步预留字段保持兼容。</p>
    </div>
    <div className="admin-form-savebar"><span aria-live="polite">{message || (dirty ? "存在未保存修改" : competition ? "当前赛事资料已同步" : "填写后即可创建赛事")}</span><div><button className="admin-button admin-button-secondary" disabled={submitting} onClick={cancel} type="button">取消</button><button className="admin-button" disabled={submitting || Boolean(competition && !dirty)} type="submit">{submitting ? "保存中…" : competition ? "保存赛事" : "创建赛事"}</button></div></div>
  </form>;
}
