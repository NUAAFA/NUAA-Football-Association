import { getPublicSitemap } from "@/lib/public-sitemap";
import { publicFeedHeaders, unavailableFeed, xmlText } from "@/lib/public-feed-response";
import { PublicReadUnavailableError } from "@/lib/public-read";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await getPublicSitemap();
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((entry) => `\n  <url><loc>${xmlText(entry.url)}</loc>${entry.lastModified ? `<lastmod>${new Date(entry.lastModified).toISOString()}</lastmod>` : ""}${entry.changeFrequency ? `<changefreq>${entry.changeFrequency}</changefreq>` : ""}${entry.priority === undefined ? "" : `<priority>${entry.priority}</priority>`}</url>`).join("")}\n</urlset>`;
    return new Response(body, { headers: { ...publicFeedHeaders, "content-type": "application/xml; charset=utf-8" } });
  } catch (error) {
    if (!(error instanceof PublicReadUnavailableError)) console.error("[public-feed] unavailable", { feed: "sitemap", category: "RenderError" });
    return unavailableFeed();
  }
}
