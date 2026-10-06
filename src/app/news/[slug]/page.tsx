import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArchiveGallery } from "@/components/competitions/archive/archive-gallery";
import { JsonLd } from "@/components/seo/json-ld";
import { NewsArticleFigure, NewsArticleLayout } from "@/components/news/news-article-layout";
import { newsDetailHref, newsListHref } from "@/components/news/news-navigation";
import { DatabaseNewsDetail } from "@/components/database-news-detail";
import {
  freshmanCupPreparationNews,
  freshmanCupPreparationNotice,
  getFreshmanCupArticle,
  getFreshmanCupContentItem,
} from "@/data/freshman-cup-2026";
import {
  getMensCupArticle,
  getMensCupNewsItem,
  officialMensCupNews,
} from "@/data/mens-intercollege-cup-2026";
import {
  getWomensCupArticle,
  getWomensCupNewsItem,
  officialWomensCupNews,
  womensCupGallery,
} from "@/data/womens-intercollege-cup-2026";
import {
  disciplineDecisions,
  getDisciplineDecision,
  getDisciplineDecisionArticle,
} from "@/data/public-information";
import { newsArticleJsonLd } from "@/lib/structured-data";
import { SITE_NAME } from "@/lib/site-metadata";
import { getPublishedContentDetailBySlug } from "@/lib/admin-content-service";
import { isDatabaseContentSource } from "@/lib/content-source";

import jointMeeting from "../../../../public/images/competitions/2026-mens-intercollege-cup/joint-meeting.jpg";
import sunset from "../../../../public/images/competitions/2026-mens-intercollege-cup/stadium-sunset.jpg";
import livePoster from "../../../../public/images/competitions/2026-mens-intercollege-cup/final-live-poster.jpg";
import mensChampions from "../../../../public/images/competitions/2026-mens-intercollege-cup/champion-zhihui-team.jpg";
import finalCelebration from "../../../../public/images/competitions/2026-mens-intercollege-cup/final-celebration-zhihui.jpg";
import womensGroup from "../../../../public/images/competitions/2026-womens-intercollege-cup/16-event-group-photo.jpg";

const articlePhotos = {
  "2026-mens-cup-joint-meeting": jointMeeting,
  "2026-mens-cup-final-preview": sunset,
  "2026-mens-cup-final-live": livePoster,
  "2026-mens-cup-closing": mensChampions,
  "2026-mens-cup-final-report": finalCelebration,
  "2026-womens-intercollege-cup-closing": womensGroup,
};

type NewsDetailPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string | string[]; cursor?: string | string[] }>;
};

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export function generateStaticParams() {
  return [
    freshmanCupPreparationNews,
    freshmanCupPreparationNotice,
    ...officialMensCupNews,
    ...officialWomensCupNews,
    ...disciplineDecisions,
  ].map((story) => ({ slug: story.id }));
}

function contentDate(dateLabel: string) {
  const normalized = dateLabel.replaceAll(".", "-").trim();
  return normalized.includes(" ") ? `${normalized.replace(" ", "T")}:00+08:00` : `${normalized}T12:00:00+08:00`;
}

export async function generateMetadata({ params }: NewsDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  if (isDatabaseContentSource()) {
    const post = await getPublishedContentDetailBySlug(slug);
    if (!post) return { robots: { index: false, follow: false } };
    const canonicalPath = `/news/${slug}`;
    const image = post.cover?.url ?? "/brand/nuaa-fa-logo.jpg";
    return {
      title: post.title,
      description: post.summary,
      alternates: { canonical: canonicalPath },
      openGraph: { type: "article", locale: "zh_CN", siteName: SITE_NAME, title: post.title, description: post.summary, url: canonicalPath, publishedTime: post.publishedAt.toISOString(), modifiedTime: post.updatedAt.toISOString(), images: [{ url: image, alt: post.cover?.altText ?? post.title }] },
      twitter: { card: "summary_large_image", title: post.title, description: post.summary, images: [image] },
    };
  }
  const story =
    getFreshmanCupContentItem(slug) ??
    getMensCupNewsItem(slug) ??
    getWomensCupNewsItem(slug) ??
    getDisciplineDecision(slug);
  if (!story) return { robots: { index: false, follow: false } };
  const canonicalPath = `/news/${slug}`;
  const image = "image" in story ? story.image : "/brand/nuaa-fa-logo.jpg";
  const imageAlt = "imageAlt" in story
    ? story.imageAlt
    : "南京航空航天大学天目湖足球协会正式标识";
  return {
    title: story.title,
    description: story.summary,
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "article",
      locale: "zh_CN",
      siteName: SITE_NAME,
      title: story.title,
      description: story.summary,
      url: canonicalPath,
      publishedTime: "publishedAt" in story ? story.publishedAt : contentDate(story.dateLabel),
      modifiedTime: "updatedAt" in story ? story.updatedAt : contentDate(story.dateLabel),
      images: [{ url: image, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title: story.title,
      description: story.summary,
      images: [image],
    },
  };
}

export default async function NewsDetailPage({ params, searchParams }: NewsDetailPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const listContext = {
    filter: typeof query.filter === "string" ? query.filter : undefined,
    cursor: typeof query.cursor === "string" ? query.cursor : undefined,
  };
  if (isDatabaseContentSource()) return <DatabaseNewsDetail slug={slug} listContext={listContext} />;
  const isWomensCupStory = Boolean(getWomensCupNewsItem(slug));
  const isFreshmanCupStory = Boolean(getFreshmanCupContentItem(slug));
  const disciplineDecision = getDisciplineDecision(slug);
  const isDisciplineDecision = Boolean(disciplineDecision);
  const story =
    getFreshmanCupContentItem(slug) ??
    getMensCupNewsItem(slug) ??
    getWomensCupNewsItem(slug) ??
    disciplineDecision;
  const article =
    getFreshmanCupArticle(slug) ??
    getMensCupArticle(slug) ??
    getWomensCupArticle(slug) ??
    getDisciplineDecisionArticle(slug);
  if (!story || !article) notFound();

  const related = [
    freshmanCupPreparationNews,
    freshmanCupPreparationNotice,
    ...officialWomensCupNews,
    ...officialMensCupNews,
    ...disciplineDecisions,
  ]
    .filter((item) => item.id !== story.id && item.category === story.category)
    .slice(0, 3)
    .map((item) => ({ title: item.title, href: newsDetailHref(item.href, listContext), meta: `${item.category} · ${item.dateLabel}` }));

  const image = "image" in story ? story.image : "/brand/nuaa-fa-logo.jpg";
  const imageAlt = "imageAlt" in story
    ? story.imageAlt
    : "南京航空航天大学天目湖足球协会正式标识";
  const publishedAt = "publishedAt" in story
    ? story.publishedAt ?? contentDate(story.dateLabel)
    : contentDate(story.dateLabel);
  const updatedAt = "updatedAt" in story
    ? story.updatedAt ?? contentDate(story.dateLabel)
    : contentDate(story.dateLabel);

  const competition = isFreshmanCupStory
    ? { label: "2026新生杯赛事详情", href: "/competitions/freshman-cup" }
    : isWomensCupStory
      ? { label: "2026女子足球院际杯赛事档案", href: "/competitions/2026-womens-intercollege-cup" }
      : getMensCupNewsItem(slug)
        ? { label: "2026男子足球院际杯赛事档案", href: "/competitions/2026-mens-intercollege-cup" }
        : undefined;
  const formal = isDisciplineDecision || story.category === "通知公告";
  const moreFilter = formal ? "notices" : story.category === "赛事新闻" || story.category === "比赛战报" ? "events" : "news";
  const photo = articlePhotos[slug as keyof typeof articlePhotos];

  return (
    <NewsArticleLayout
      title={story.title}
      summary={story.summary}
      category={story.category}
      dateLabel={story.dateLabel}
      dateTime={publishedAt}
      source={story.source}
      formal={formal}
      decision={isDisciplineDecision}
      context={competition ?? (disciplineDecision ? { label: disciplineDecision.scope } : undefined)}
      returnHref={newsListHref(listContext)}
      moreHref={newsListHref({ filter: moreFilter })}
      moreLabel={formal ? "更多通知公告" : moreFilter === "events" ? "更多赛事报道" : "更多新闻"}
      attachments={disciplineDecision ? [{
        title: `${disciplineDecision.title}（原件）`,
        href: disciplineDecision.pdfHref,
        fileType: disciplineDecision.fileType,
        source: disciplineDecision.source,
        date: disciplineDecision.dateLabel,
        version: disciplineDecision.version,
      }] : []}
      related={related}
    >
      <JsonLd data={newsArticleJsonLd({ title: story.title, summary: story.summary, path: `/news/${story.id}`, publishedAt, updatedAt, image })} />
      {photo ? <NewsArticleFigure src={photo} alt={imageAlt} caption={imageAlt} /> : null}
      {article.blocks.map((block, index) =>
        block.type === "paragraph" ? (
          <p key={`${story.id}-paragraph-${index}`}>{block.text}</p>
        ) : block.type === "heading" ? (
          <h2 key={`${story.id}-heading-${index}`}>{block.text}</h2>
        ) : (
          <ul key={`${story.id}-list-${index}`}>
            {block.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ),
      )}
      {isFreshmanCupStory ? (
        <blockquote>报名时间、比赛日期、比赛场地、参赛资格和竞赛规程以协会后续正式公告为准。</blockquote>
      ) : isWomensCupStory ? (
        <>
          <h2>赛事影像</h2>
          <ArchiveGallery images={womensCupGallery} ariaLabel="2026女子足球院际杯收官报道原始照片" className="detail-archive-gallery" showCaptions />
        </>
      ) : !isDisciplineDecision ? (
        <blockquote>本文数据来自赛事秩序册、足球中国赛事后台及湖区FA公众号归档资料。</blockquote>
      ) : null}
    </NewsArticleLayout>
  );
}
