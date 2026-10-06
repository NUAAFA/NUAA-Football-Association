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
  // The public DB projection has a competition name, but no routable slug.
  // Keep that verified context as text instead of guessing an archive relationship.
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
    attachments={attachment ? [{
      title: attachment.filename,
      href: attachment.url,
      fileType: "PDF",
      source: post.source,
      version: post.discipline?.versionLabel,
    }] : []}
  >
    <JsonLd data={newsArticleJsonLd({ title: post.title, summary: post.summary, path: `/news/${post.slug}`, publishedAt: post.publishedAt.toISOString(), updatedAt: post.updatedAt.toISOString(), image: post.cover?.url ?? "/brand/nuaa-fa-logo.jpg" })} />
    {!formal && post.cover ? <NewsArticleFigure src={post.cover.url} alt={post.cover.altText ?? post.title} /> : null}
    <StructuredContentView value={post.content} />
  </NewsArticleLayout>;
}
