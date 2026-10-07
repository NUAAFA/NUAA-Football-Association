import Image from "next/image";

import styles from "@/components/media/media.module.css";
import type { MediaCollectionData } from "@/data/media-collections";

type MediaCollectionProps = {
  collection: MediaCollectionData;
  showReport: boolean;
};

// Match the U1 wide container, responsive gutters, and 16px grid gaps.
const photoSizes = "(max-width: 720px) calc((100vw - 48px) / 2), (max-width: 1023px) calc((100vw - 56px) / 2), (max-width: 1100px) calc((100vw - 88px) / 4), (max-width: 1304px) calc((100vw - 112px) / 4), 298px";

export function MediaCollection({ collection, showReport }: MediaCollectionProps) {
  return (
    <section className={styles.collection} id={collection.id} aria-labelledby={`${collection.id}-title`}>
      <header className={styles.collectionHeading}>
        <h2 id={`${collection.id}-title`}>{collection.title}</h2>
        <p>{collection.context}</p>
      </header>
      <div className={styles.gallery}>
        {collection.images.map((image) => (
          <figure key={image.src}>
            <a className={styles.originalLink} href={image.src} aria-label={`${image.alt}，查看原图`}>
              <Image
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                loading="lazy"
                sizes={photoSizes}
              />
            </a>
            <figcaption>{image.alt}</figcaption>
          </figure>
        ))}
      </div>
      <div className={styles.collectionLinks}>
        <a className={styles.archiveLink} href={collection.archiveHref}>
          查看完整赛事影像 <span aria-hidden="true">→</span>
        </a>
        {showReport && collection.reportHref ? (
          <a className={styles.reportLink} href={collection.reportHref}>阅读赛事收官报道</a>
        ) : null}
      </div>
    </section>
  );
}
