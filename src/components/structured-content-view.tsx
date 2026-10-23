import Image from "@/components/ui/site-image";
import type { ReactNode } from "react";

import { validateStructuredContent, type StructuredContentNode, type StructuredTextNode } from "@/lib/admin-content-input";

function renderText(node: StructuredTextNode, key: string) {
  let result: ReactNode = node.text;
  for (const [index, mark] of (node.marks ?? []).entries()) {
    const markKey = `${key}-mark-${index}`;
    if (mark.type === "bold") result = <strong key={markKey}>{result}</strong>;
    else if (mark.type === "italic") result = <em key={markKey}>{result}</em>;
    else if (mark.type === "underline") result = <u key={markKey}>{result}</u>;
    else if ("attrs" in mark) result = <a href={mark.attrs.href} key={markKey} rel="noopener noreferrer nofollow" target={mark.attrs.href.startsWith("http") ? "_blank" : undefined}>{result}</a>;
  }
  return result;
}

function renderInline(content: StructuredTextNode[] | undefined, key: string) {
  return content?.map((node, index) => <span key={`${key}-${index}`}>{renderText(node, `${key}-${index}`)}</span>);
}

function renderNode(node: StructuredContentNode, key: string): ReactNode {
  if (node.type === "paragraph") return <p key={key}>{renderInline(node.content, key)}</p>;
  if (node.type === "heading") return node.attrs.level === 2
    ? <h2 key={key}>{renderInline(node.content, key)}</h2>
    : <h3 key={key}>{renderInline(node.content, key)}</h3>;
  if (node.type === "horizontalRule") return <hr key={key} />;
  if (node.type === "image") return <figure className="detail-story-figure" key={key}><Image alt={node.attrs.alt ?? "正文图片"} height={675} src={node.attrs.src} width={1200} /></figure>;
  if (node.type === "blockquote") return <blockquote key={key}>{node.content.map((child, index) => renderNode(child, `${key}-${index}`))}</blockquote>;
  if (node.type === "bulletList") return <ul className="detail-story-list" key={key}>{node.content.map((child, index) => renderNode(child, `${key}-${index}`))}</ul>;
  if (node.type === "orderedList") return <ol className="detail-story-list" key={key}>{node.content.map((child, index) => renderNode(child, `${key}-${index}`))}</ol>;
  return <li key={key}>{node.content.map((child, index) => renderNode(child, `${key}-${index}`))}</li>;
}

export function StructuredContentView({ value }: { value: unknown }) {
  const structured = validateStructuredContent(value);
  return <>{structured.document.content.map((node, index) => renderNode(node, `content-${index}`))}</>;
}
