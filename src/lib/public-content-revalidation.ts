import "server-only";
import { revalidatePath } from "next/cache";

export function revalidatePublicContentPaths() {
  revalidatePath("/");
  revalidatePath("/news");
  revalidatePath("/news/[slug]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/rss.xml");
}
