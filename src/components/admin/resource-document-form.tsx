"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MediaPicker } from "@/components/admin/media-picker";
import { AdminStatusBadge } from "@/components/referees/admin/admin-ui";
import { getResourceDestinations, resourceAreas, resourceCategories, resourceStatusLabels, resourceVersionLabels, type ResourceCategory, type ResourceFormValue } from "@/data/resource-options";
import styles from "./resource-library.module.css";

export function ResourceDocumentForm({ initial, initialCategory }: { initial?: ResourceFormValue; initialCategory?: ResourceCategory }) {
  const router = useRouter();
  const [category, setCategory] = useState(initial?.category ?? initialCategory ?? "guidebooks");
  const [playingFormat, setPlayingFormat] = useState(initial?.playingFormat ?? "all");
  const [trainingLevel, setTrainingLevel] = useState(initial?.trainingLevel ?? "基础");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [media, setMedia] = useState({ id: initial?.mediaAssetId ?? "", label: initial?.fileLabel ?? "" });
  const [uploadBusy, setUploadBusy] = useState(false), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || uploadBusy) return;
    const status = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "DRAFT";
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setMessage("");
    try {
      const response = await fetch(initial?.id ? `/api/admin/resources/${encodeURIComponent(initial.id)}` : "/api/admin/resources", {
        method: initial?.id ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, category, title, status, mediaAssetId: media.id || null, sortOrder: Number(values.sortOrder), confirmPublic: confirmed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "资料保存失败。");
      router.replace(`/admin/resources?message=${encodeURIComponent(status === "PUBLISHED" ? "资料已发布，前台栏目已更新。" : status === "ARCHIVED" ? "资料已下架。" : "资料草稿已保存。")}`);
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "资料保存失败。"); }
    finally { setBusy(false); }
  }

  return <form className={`admin-form ops-content-form ${styles.resourceForm}`} onSubmit={submit}>
    <section className={`admin-form-section ${styles.fileSection}`}>
      <header><h2>1. 分类与原文件</h2><p>先选择文件用途，再上传 PDF 或从媒体库选择已有文件。</p></header>
      <div className="admin-form-grid">
        <label><span>资料分类</span><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} name="category">{resourceAreas.map((area) => <optgroup key={area.key} label={area.label}>{resourceCategories.filter((option) => (area.categories as readonly string[]).includes(option.key)).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</optgroup>)}</select></label>
        {category === "regulations" ? <label><span>规则适用赛制</span><select value={playingFormat} onChange={(event) => setPlayingFormat(event.target.value as typeof playingFormat)} name="playingFormat"><option value="all">十一人制与五人制均适用</option><option value="eleven-a-side">十一人制</option><option value="futsal">五人制</option></select></label> : <input name="playingFormat" type="hidden" value={playingFormat} />}
        {category === "training" ? <label><span>培训阶段</span><select value={trainingLevel} onChange={(event) => setTrainingLevel(event.target.value as typeof trainingLevel)} name="trainingLevel">{["基础", "专项", "进阶"].map((level) => <option key={level}>{level}</option>)}</select></label> : <input name="trainingLevel" type="hidden" value={trainingLevel} />}
      </div>
      <aside className={styles.destinationPreview} aria-labelledby="resource-destination-title">
        <strong id="resource-destination-title">发布位置{category === "regulations" ? " · 两处同步" : ""}</strong>
        <ul>{getResourceDestinations(category, playingFormat, trainingLevel).map((destination) => <li key={destination.href}><Link href={destination.href} target="_blank" rel="noreferrer">{destination.label} ↗</Link></li>)}</ul>
      </aside>
      <div className={styles.currentFile} role="status"><span>当前文件</span><strong>{media.label || "尚未选择 · 支持 PDF，最大 20 MB"}</strong></div>
      <MediaPicker mode="files" purpose="resource" onBusy={setUploadBusy} onSelect={(asset) => { setMedia({ id: asset.id, label: asset.originalFilename }); if (!title) setTitle(asset.originalFilename.replace(/\.pdf$/i, "")); }} />
    </section>
    <section className="admin-form-section">
      <header><h2>2. 资料信息</h2><p>标题、版本和适用范围会显示在对应的前台资料栏目。</p></header>
      <div className="admin-form-grid">
        <label className="admin-form-span-2"><span>资料标题</span><input maxLength={160} name="title" required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>版本</span><input defaultValue={initial?.version} maxLength={80} name="version" placeholder="例如 2026/2027" /></label>
        <label><span>版本状态</span><select defaultValue={initial?.versionStatus ?? "historical"} name="versionStatus">{Object.entries(resourceVersionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label><span>来源 / 发布单位</span><input defaultValue={initial?.source} maxLength={120} name="source" /></label>
        <label><span>适用范围</span><input defaultValue={initial?.scope} maxLength={160} name="scope" /></label>
        <label className="admin-form-span-2"><span>资料说明</span><textarea defaultValue={initial?.description} maxLength={1000} name="description" rows={3} /></label>
      </div>
      <details className={styles.moreSettings}>
        <summary>更多设置 · 发布日期、排序与版本说明</summary>
        <div className="admin-form-grid">
          <label><span>文件发布日期</span><input defaultValue={initial?.dateLabel} maxLength={40} name="dateLabel" placeholder="例如 2026.10；未确认可留空" /></label>
          <label><span>排序</span><input defaultValue={initial?.sortOrder ?? 0} min={-10000} max={10000} name="sortOrder" required type="number" /><small>同一分类内，数值越小越靠前。</small></label>
          <label className="admin-form-span-2"><span>版本提示 / 使用说明</span><textarea defaultValue={initial?.versionNote} maxLength={500} name="versionNote" rows={3} /></label>
        </div>
      </details>
    </section>
    <section className="admin-form-section">
      <header><h2>3. 保存与发布</h2><p>保存草稿仅在后台可见；发布后显示在上方指定的栏目。</p></header>
      <label className="admin-inline-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>已确认资料和原文件可以公开，发布时将原文件设为公开。</span></label>
      <p className={styles.publishHelp}>下架会移除栏目展示，保留原文件。文件访问范围可在“媒体与附件”中管理。</p>
      <p aria-live="polite" className="admin-form-message">{message}</p>
    </section>
    <footer className="admin-form-savebar">
      <div className={styles.saveStatus}><AdminStatusBadge status={initial?.status ?? "DRAFT"} label={initial ? resourceStatusLabels[initial.status] : "尚未保存"} /><span>{media.label ? "原文件已选择" : "请选择原文件"}</span></div>
      <div>
        <Link className="admin-button admin-button-secondary" href="/admin/resources">返回列表</Link>
        <button className="admin-button admin-button-secondary" disabled={busy || uploadBusy} name="status" value="DRAFT" type="submit">保存草稿</button>
        {initial ? <button className="admin-button admin-button-danger" disabled={busy || uploadBusy} name="status" value="ARCHIVED" type="submit">下架资料</button> : null}
        <button className="admin-button" disabled={busy || uploadBusy || !confirmed} name="status" value="PUBLISHED" type="submit">{busy ? "保存中…" : "发布资料"}</button>
      </div>
    </footer>
  </form>;
}
