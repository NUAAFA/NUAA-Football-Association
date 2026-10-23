import Image from "@/components/ui/site-image";
import Link from "next/link";

import { getPublishedCompetitionImages } from "@/lib/competition-report-service";
import styles from "./competition-media.module.css";

type PublicImages = Awaited<ReturnType<typeof getPublishedCompetitionImages>>;

export function CompetitionImageGallery({ images }: { images: PublicImages }) {
  return <div className={styles.gallery}>{images.map((image) => <figure key={image.id}>
    <a className={styles.image} href={image.src} target="_blank" rel="noopener noreferrer" aria-label={`${image.alt}，查看原图（新标签页）`}>
      <Image src={image.src} alt={image.alt} fill sizes="(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 33vw" loading="lazy" />
    </a>
    <figcaption><p>{image.alt}</p><Link href={image.reportHref}>阅读相关报道 →</Link>{image.source ? <small>来源：{image.source}</small> : null}</figcaption>
  </figure>)}</div>;
}

export async function CompetitionMedia({ competitionId }: { competitionId: string }) {
  const images = await getPublishedCompetitionImages(competitionId);
  return images.length ? <CompetitionImageGallery images={images} /> : <p>赛事照片和视频将在影像资料页面陆续发布。</p>;
}
