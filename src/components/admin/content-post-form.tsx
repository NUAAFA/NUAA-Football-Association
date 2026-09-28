"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { MediaPicker } from "@/components/admin/media-picker";
import { StructuredContentEditor } from "@/components/admin/structured-content-editor";

type ContentType = "NEWS" | "ANNOUNCEMENT" | "DISCIPLINE";

type ContentPostFormValue = {
  id?: string;
  type: ContentType;
  slug: string;
  title: string;
  summary: string;
  contentJson: string;
  source: string;
  coverMediaId: string;
  pinned: boolean;
  featured: boolean;
  attachments?: Array<{ mediaAssetId: string; displayName?: string | null; filename: string; visibility: string; mimeType?: string }>;
  discipline: {
    competitionId: string;
    officialMediaId: string;
    versionLabel: string;
    scopeLabel: string;
  };
};

export function ContentPostForm({
  initialValue,
  imageMedia,
  pdfMedia,
  competitions,
}: {
  initialValue: ContentPostFormValue;
  imageMedia: Array<{ id: string; originalFilename: string }>;
  pdfMedia: Array<{ id: string; originalFilename: string }>;
  competitions: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [type, setType] = useState<ContentType>(initialValue.type);
  const [attachments, setAttachments] = useState(initialValue.attachments ?? []);
  const [coverId, setCoverId] = useState(initialValue.coverMediaId);
  const [pickedCover, setPickedCover] = useState<{ id: string; originalFilename: string } | null>(null);
  const [officialId, setOfficialId] = useState(initialValue.discipline.officialMediaId);
  const [dirty, setDirty] = useState(false), [activeUploads, setActiveUploads] = useState(0);
  const uploadBusy = activeUploads > 0;
  const setUploadBusy = (value: boolean) => setActiveUploads((n) => Math.max(0, n + (value ? 1 : -1)));
  useEffect(() => { const before = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; const leave = (e: MouseEvent) => { const a = (e.target as HTMLElement).closest("a"); if (dirty && a && a.target !== "_blank" && !a.href.includes("#") && !window.confirm("内容尚未保存，确认离开？")) e.preventDefault(); }; window.addEventListener("beforeunload", before); document.addEventListener("click", leave, true); return () => { window.removeEventListener("beforeunload", before); document.removeEventListener("click", leave, true); }; }, [dirty]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || uploadBusy) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const status = submitter?.value ?? "DRAFT";
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(
        initialValue.id ? `/api/admin/content/posts/${initialValue.id}` : "/api/admin/content/posts",
        {
          method: initialValue.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type,
            slug: form.get("slug") || `post-${crypto.randomUUID()}`,
            attachments: attachments.map(({ mediaAssetId, displayName }) => ({ mediaAssetId, displayName })),
            title: form.get("title"),
            summary: form.get("summary"),
            content: form.get("content"),
            source: form.get("source"),
            coverMediaId: coverId,
            pinned: form.get("pinned") === "on",
            featured: form.get("featured") === "on",
            status,
            discipline: type === "DISCIPLINE" ? {
              competitionId: form.get("competitionId"),
              officialMediaId: officialId,
              versionLabel: form.get("versionLabel"),
              scopeLabel: form.get("scopeLabel"),
            } : null,
          }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "保存失败。");
      setDirty(false);
      const success = status === "PUBLISHED" ? "内容已发布" : status === "ARCHIVED" ? "内容已归档" : "草稿已保存";
      router.replace(`/admin/content/news?message=${encodeURIComponent(success)}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-form ops-content-form" onChange={() => setDirty(true)} onSubmit={submit}>
      <section className="admin-form-section">
        <header><h2>基础信息</h2><p>固定网址标识保存后保持稳定；已有发布记录的地址不可更改。</p></header>
        <div className="admin-form-grid">
          <label><span>内容类型</span><select name="type" onChange={(event) => setType(event.target.value as ContentType)} value={type}><option value="NEWS">新闻</option><option value="ANNOUNCEMENT">公告</option><option value="DISCIPLINE">纪律处罚</option></select></label>
          <details><summary>高级设置 · 固定网址标识</summary><label><span>网址标识（新内容留空自动生成）</span><input defaultValue={initialValue.slug} maxLength={120} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" readOnly={Boolean(initialValue.id)} /></label></details>
          <label className="admin-form-span-2"><span>标题</span><input defaultValue={initialValue.title} maxLength={160} name="title" required /></label>
          <label className="admin-form-span-2"><span>摘要</span><textarea defaultValue={initialValue.summary} maxLength={500} name="summary" required rows={4} /></label>
          <label><span>来源 / 发布部门</span><input defaultValue={initialValue.source} maxLength={120} name="source" /></label>
          <label><span>封面图片（需公开文件）</span><select value={coverId} onChange={(e) => setCoverId(e.target.value)} name="coverMediaId"><option value="">暂不设置</option>{[...imageMedia, ...(pickedCover && !imageMedia.some((a) => a.id === pickedCover.id) ? [pickedCover] : [])].map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFilename}</option>)}</select></label>
        </div><MediaPicker mode="images" onBusy={setUploadBusy} onSelect={(a) => { setCoverId(a.id); setPickedCover(a); setDirty(true); }} />
      </section>
      {type === "DISCIPLINE" ? <section className="admin-form-section">
        <header><h2>纪律处罚信息</h2><p>仅保存已确认的赛事、正式 PDF、版本和适用范围。</p></header>
        <div className="admin-form-grid">
          <label><span>关联赛事</span><select defaultValue={initialValue.discipline.competitionId} name="competitionId"><option value="">暂不关联</option>{competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label>
          <label><span>正式 PDF（需公开文件）</span><select value={officialId} onChange={(e) => setOfficialId(e.target.value)} name="officialMediaId"><option value="">草稿暂不设置</option>{[...pdfMedia, ...attachments.filter((a) => a.mimeType === "application/pdf" && !pdfMedia.some((p) => p.id === a.mediaAssetId)).map((a) => ({ id: a.mediaAssetId, originalFilename: a.filename }))].map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFilename}</option>)}</select></label>
          <label><span>版本标签</span><input defaultValue={initialValue.discipline.versionLabel} maxLength={80} name="versionLabel" /></label>
          <label><span>适用范围</span><input defaultValue={initialValue.discipline.scopeLabel} maxLength={160} name="scopeLabel" /></label>
        </div>
      </section> : null}
      <section className="admin-form-section">
        <header><h2>正文</h2><p>支持标题、列表、链接与图片；保存时自动检查安全格式。</p></header>
        <StructuredContentEditor imageMedia={imageMedia} initialValue={initialValue.contentJson} onDirty={() => setDirty(true)} onBusy={setUploadBusy} />
      </section>
      <section className="admin-form-section"><header><h2>附件</h2><p>正文后显示下载附件；排序及移除仅修改本内容的关联。纪律正式原件与相同附件不会重复展示。</p></header><MediaPicker mode="all" onBusy={setUploadBusy} onSelect={(a) => { setAttachments((old) => old.some((x) => x.mediaAssetId === a.id) ? old : [...old, { mediaAssetId: a.id, displayName: a.originalFilename, filename: a.originalFilename, visibility: a.visibility, mimeType: a.mimeType }]); setDirty(true); }} />{attachments.map((a, index) => <div className="ops-attachment-row" key={a.mediaAssetId}><label><span>附件显示名称</span><input value={a.displayName ?? a.filename} maxLength={180} onChange={(e) => { setAttachments((old) => old.map((x) => x.mediaAssetId === a.mediaAssetId ? { ...x, displayName: e.target.value } : x)); setDirty(true); }} /></label><a className="admin-button admin-button-secondary" href={`/media/${a.mediaAssetId}`} target="_blank" rel="noreferrer">打开</a><span>{a.visibility === "PUBLIC" ? "公开文件" : "仅后台"}</span>{a.visibility !== "PUBLIC" ? <button type="button" onClick={async () => { if (!window.confirm(`确认“${a.filename}”可公开访问？共享该文件的其他使用处也会受影响。`)) return; const r = await fetch(`/api/admin/media/${a.mediaAssetId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: "PUBLIC", confirm: true }) }); const data = await r.json(); if (!r.ok) { setMessage(data.error || "操作失败"); return; } setAttachments((old) => old.map((x) => x.mediaAssetId === a.mediaAssetId ? { ...x, visibility: "PUBLIC" } : x)); }}>确认公开文件</button> : null}{type === "DISCIPLINE" && a.mimeType === "application/pdf" ? <button type="button" onClick={() => { setOfficialId(a.mediaAssetId); setDirty(true); }}>{officialId === a.mediaAssetId ? "已设为正式原件" : "设为正式原件（PDF）"}</button> : null}<button disabled={index === 0} type="button" onClick={() => { setAttachments((old) => { const next = [...old]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); setDirty(true); }}>上移</button><button disabled={index === attachments.length - 1} type="button" onClick={() => { setAttachments((old) => { const next = [...old]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; }); setDirty(true); }}>下移</button><button type="button" onClick={() => { setAttachments((old) => old.filter((x) => x.mediaAssetId !== a.mediaAssetId)); setDirty(true); }}>移除附件关联</button></div>)}</section>
      <section className="admin-form-section">
        <header><h2>展示设置</h2><p>“置顶”只改变普通新闻列表顺序；“首页推荐”是独立标记，不会改变普通列表顺序。</p></header>
        <div className="admin-inline-checks">
          <label><input defaultChecked={initialValue.pinned} name="pinned" type="checkbox" /><span>置顶 · 仅影响新闻列表排序</span></label>
          <label><input defaultChecked={initialValue.featured} name="featured" type="checkbox" /><span>首页推荐 · 独立候选池</span></label>
        </div>
      </section>
      <p aria-live="polite" className="admin-form-message">{message}</p>
      <footer className="admin-form-savebar">
        <span>请选择保存草稿、发布或归档；服务端会再次验证权限和关联媒体。</span>
        <div>
          <Link className="admin-button admin-button-secondary" href="/admin/content/news">取消</Link>
          {initialValue.id ? <Link className="admin-button admin-button-secondary" href={`/admin/content/news/${initialValue.id}/preview`} target="_blank">预览已保存版本</Link> : null}
          <button className="admin-button admin-button-secondary" disabled={submitting || uploadBusy} name="status" type="submit" value="DRAFT">保存草稿</button>
          {initialValue.id ? <button className="admin-button admin-button-danger" disabled={submitting || uploadBusy} name="status" type="submit" value="ARCHIVED">归档</button> : null}
          <button className="admin-button" disabled={submitting || uploadBusy} name="status" type="submit" value="PUBLISHED">发布</button>
        </div>
      </footer>
    </form>
  );
}
