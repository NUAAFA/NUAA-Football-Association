"use client";

import { MediaPicker } from "@/components/admin/media-picker";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMemo, useState } from "react";

type MediaChoice = { id: string; originalFilename: string };

function readInitialDocument(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      schemaVersion?: number;
      document?: Record<string, unknown>;
      type?: string;
      content?: unknown[];
    };
    if (parsed.schemaVersion === 1 && parsed.document?.type === "doc") return parsed.document;
    if (parsed.schemaVersion === 1 && parsed.type === "doc") return { type: "doc", content: parsed.content ?? [] };
  } catch {
    // The server remains authoritative and will reject malformed JSON.
  }
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function sanitizePastedHtml(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((node) => node.remove());
  for (const element of document.body.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on") || attribute.name.toLowerCase() === "style") {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return document.body.innerHTML;
}

export function StructuredContentEditor({ initialValue, imageMedia, onDirty, onBusy }: { initialValue: string; imageMedia: MediaChoice[]; onDirty?: () => void; onBusy?: (busy: boolean) => void }) {
  const initialDocument = useMemo(() => readInitialDocument(initialValue), [initialValue]);
  const [serialized, setSerialized] = useState(() => JSON.stringify({ schemaVersion: 1, document: initialDocument }));
  const [selectedMediaId, setSelectedMediaId] = useState(imageMedia[0]?.id ?? "");
  const editor = useEditor({
    immediatelyRender: false,
    content: initialDocument,
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        strike: false,
        hardBreak: false,
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: false,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        },
      }),
      Image.configure({ allowBase64: false, inline: false }),
    ],
    editorProps: {
      attributes: { class: "admin-rich-text-surface", "aria-label": "结构化正文编辑器" },
      transformPastedHTML: sanitizePastedHtml,
    },
    onUpdate: ({ editor: current }) => {
      setSerialized(JSON.stringify({ schemaVersion: 1, document: current.getJSON() }));
      onDirty?.();
    },
  });

  function setLink() {
    if (!editor) return;
    const current = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("输入 http(s)、mailto 或站内 / 路径", current ?? "https://");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  }

  function insertImage() {
    if (!editor || !selectedMediaId) return;
    const selected = imageMedia.find((asset) => asset.id === selectedMediaId);
    editor.chain().focus().setImage({ src: `/media/${selectedMediaId}`, alt: selected?.originalFilename ?? "" }).run();
  }

  return (
    <div className="admin-rich-text-editor">
      <div aria-label="正文格式工具栏" className="admin-rich-text-toolbar" role="toolbar">
        <button aria-pressed={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} type="button">H2</button>
        <button aria-pressed={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} type="button">H3</button>
        <button aria-pressed={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} type="button"><strong>B</strong></button>
        <button aria-pressed={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} type="button"><em>I</em></button>
        <button aria-pressed={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} type="button"><u>U</u></button>
        <button aria-pressed={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} type="button">项目列表</button>
        <button aria-pressed={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} type="button">编号列表</button>
        <button aria-pressed={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()} type="button">引用</button>
        <button aria-pressed={editor?.isActive("link")} onClick={setLink} type="button">链接</button>
        <button onClick={() => editor?.chain().focus().setHorizontalRule().run()} type="button">分隔线</button>
      </div>
      <EditorContent editor={editor} />
      <div className="admin-rich-text-media">
        <label><span>插入媒体库图片</span><select onChange={(event) => setSelectedMediaId(event.target.value)} value={selectedMediaId}><option value="">请选择 PUBLIC 图片</option>{imageMedia.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFilename}</option>)}</select></label>
        <button className="admin-button admin-button-secondary" disabled={!selectedMediaId} onClick={insertImage} type="button">插入图片</button>
      </div>
      <MediaPicker mode="images" onBusy={onBusy} onSelect={(a) => editor?.chain().focus().setImage({ src: `/media/${a.id}`, alt: a.originalFilename }).run()} />
      <textarea aria-hidden="true" name="content" readOnly required tabIndex={-1} value={serialized} />
      <small>插入的正文图片与封面、下载附件相互独立。发布时正文图片须为公开文件。</small>
    </div>
  );
}
