"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MediaUploadForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    setSubmitting(true);
    setMessage("");
    try {
      const values = new FormData(form);
      const file = values.get("file");
      if (!(file instanceof File)) throw new Error("请选择有效文件。");
      const response = await fetch("/api/admin/media", {
        method: "POST",
        headers: {
          "content-type": file.type,
          "x-nuaafa-filename": encodeURIComponent(file.name),
          "x-nuaafa-visibility": String(values.get("visibility") ?? "PRIVATE"),
          "x-nuaafa-alt-text": encodeURIComponent(String(values.get("altText") ?? "")),
        },
        body: file,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "上传失败。");
      form.reset();
      setMessage("文件上传成功，可在内容编辑页选择使用。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="admin-form admin-media-upload-form" onSubmit={submit}>
      <div className="admin-form-grid">
        <label><span>文件</span><input accept="image/jpeg,image/png,image/webp,application/pdf" name="file" required type="file" /><small>JPG / PNG / WEBP 最大 10 MB；PDF 最大 20 MB。</small></label>
        <label><span>可见性</span><select defaultValue="PRIVATE" name="visibility"><option value="PRIVATE">仅后台</option><option value="PUBLIC">公开文件（已确认可公开）</option></select><small>默认仅后台；公开文件可直接通过媒体地址访问，草稿不会使其私密。</small></label>
        <label className="admin-form-span-2"><span>替代文字 / 文件说明</span><input maxLength={240} name="altText" placeholder="图片建议填写；PDF 可填写文件说明" /></label>
      </div>
      <p aria-live="polite" className="admin-form-message">{message}</p>
      <footer><button className="admin-button" disabled={submitting} type="submit">{submitting ? "上传中…" : "上传文件"}</button></footer>
    </form>
  );
}
