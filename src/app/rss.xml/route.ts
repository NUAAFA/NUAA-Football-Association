import { getPublicDiscoveryItems } from "@/lib/public-content-discovery";
import { publicFeedHeaders, unavailableFeed, xmlText } from "@/lib/public-feed-response";
import { PublicReadUnavailableError } from "@/lib/public-read";
import { absoluteSiteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getPublicDiscoveryItems({ take: 30 });
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlText(SITE_NAME)}</title>
    <link>${xmlText(absoluteSiteUrl("/"))}</link>
    <description>${xmlText(SITE_DESCRIPTION)}</description>
    <language>zh-CN</language>
    ${items.map((item) => `<item>
      <title>${xmlText(item.title)}</title>
      <link>${xmlText(absoluteSiteUrl(item.href))}</link>
      <guid isPermaLink="true">${xmlText(absoluteSiteUrl(item.href))}</guid>
      <description>${xmlText(item.summary)}</description>
      <pubDate>${item.publishedAt.toUTCString()}</pubDate>
    </item>`).join("\n    ")}
  </channel>
</rss>`;
    return new Response(body, { headers: { ...publicFeedHeaders, "content-type": "application/rss+xml; charset=utf-8" } });
  } catch (error) {
    if (!(error instanceof PublicReadUnavailableError)) console.error("[public-feed] unavailable", { feed: "rss", category: "RenderError" });
    return unavailableFeed();
  }
}
