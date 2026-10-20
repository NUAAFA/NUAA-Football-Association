import { notFound } from "next/navigation";

import { JsonLd } from "@/components/seo/json-ld";
import { StructuredContentView } from "@/components/structured-content-view";
import { NewsArticleFigure, NewsArticleLayout } from "@/components/news/news-article-layout";
import { newsListHref, type NewsListContext } from "@/components/news/news-navigation";
import { getPublishedContentDetailBySlug } from "@/lib/admin-content-service";
import { newsArticleJsonLd } from "@/lib/structured-data";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export async function DatabaseNewsDetail({ slug, listContext = {} }: { slug: string; listContext?: NewsListContext }) {
  const post = await getPublishedContentDetailBySlug(slug);
  if (!post) notFound();
  const attachment = post.discipline?.officialMedia;
  const decision = post.type === "DISCIPLINE";
  const formal = post.type !== "NEWS";
  const category = decision ? "纪律决定" : formal ? "通知公告" : "新闻";
  const contextLabel = post.discipline?.competitionName ?? post.discipline?.scopeLabel;
  const files = new Map<string, { url: string; filename: string; mimeType: string; size?: number }>(post.attachments.map((file) => [file.url, file]));
  if (attachment && !files.has(attachment.url)) files.set(attachment.url, attachment);
  const fileTypes: Record<string, string> = {
    "application/pdf": "PDF", "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP",
  };
  // Use the public projection's MIME metadata, never the display filename.
  return <NewsArticleLayout
    title={post.title}
    summary={post.summary}
    category={category}
    dateLabel={formatDate(post.publishedAt)}
    dateTime={post.publishedAt.toISOString()}
    source={post.source}
    formal={formal}
    decision={decision}
    context={contextLabel ? { label: contextLabel } : undefined}
    returnHref={newsListHref(listContext)}
    moreHref="/news"
    moreLabel="浏览更多新闻公告"
    attachments={[...files.values()].map((file) => ({
      title: file.url === attachment?.url ? `正式文件 · ${file.filename}` : file.filename,
      href: file.url,
      fileType: fileTypes[file.mimeType] ?? file.mimeType,
      size: file.size,
      source: post.source,
      version: file.url === attachment?.url ? post.discipline?.versionLabel : undefined,
    }))}
  >
    <JsonLd data={newsArticleJsonLd({ title: post.title, summary: post.summary, path: `/news/${post.slug}`, publishedAt: post.publishedAt.toISOString(), updatedAt: post.updatedAt.toISOString(), image: post.cover?.url ?? "/brand/nuaa-fa-logo.jpg" })} />
    {!formal && post.cover ? <NewsArticleFigure src={post.cover.url} alt={post.cover.altText ?? post.title} /> : null}
    <StructuredContentView value={post.content} />
  </NewsArticleLayout>;
}
