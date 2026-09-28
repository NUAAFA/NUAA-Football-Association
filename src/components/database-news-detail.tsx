import Image from "next/image";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/seo/json-ld";
import { ShareActions } from "@/components/share/share-actions";
import { StructuredContentView } from "@/components/structured-content-view";
import { DetailPageLayout } from "@/components/templates/detail-page-layout";
import { getPublishedContentDetailBySlug } from "@/lib/admin-content-service";
import { newsArticleJsonLd } from "@/lib/structured-data";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export async function DatabaseNewsDetail({ slug }: { slug: string }) {
  const post = await getPublishedContentDetailBySlug(slug);
  if (!post) notFound();
  const attachment = post.discipline?.officialMedia;
  return <DetailPageLayout
    attachmentsAfterBody
    attachments={[...post.attachments.map((a) => ({ href: a.url, label: a.url === attachment?.url ? `正式文件 · ${a.filename}` : `查看 / 下载 ${a.filename}` })), ...(attachment && !post.attachments.some((a) => a.url === attachment.url) ? [{ href: attachment.url, label: `正式文件 · ${attachment.filename}` }] : [])]}
    description={post.summary}
    eyebrow={post.type === "DISCIPLINE" ? "DISCIPLINARY DECISION / 纪律决定" : post.type === "ANNOUNCEMENT" ? "OFFICIAL NOTICE / 通知公告" : "OFFICIAL NEWS / 协会新闻"}
    meta={{ source: post.source ?? "NUAAFA", published: formatDate(post.publishedAt), updated: formatDate(post.updatedAt), sourceLabel: post.type === "DISCIPLINE" ? "发布单位" : "来源" }}
    statusLabel={post.type === "DISCIPLINE" ? "纪律决定 · 正式发布" : "数据库内容 · 正式发布"}
    title={post.title}
  >
    <JsonLd data={newsArticleJsonLd({ title: post.title, summary: post.summary, path: `/news/${post.slug}`, publishedAt: post.publishedAt.toISOString(), updatedAt: post.updatedAt.toISOString(), image: post.cover?.url ?? "/brand/nuaa-fa-logo.jpg" })} />
    <ShareActions text={post.summary} title={post.title} />
    {post.cover ? <figure className="detail-story-figure"><Image alt={post.cover.altText ?? post.title} fill sizes="(max-width: 720px) 100vw, 780px" src={post.cover.url} /></figure> : null}
    <p className="detail-article-lead">{post.summary}</p>
    <StructuredContentView value={post.content} />
  </DetailPageLayout>;
}
