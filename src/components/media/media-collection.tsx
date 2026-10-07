import { MediaGallery } from "@/components/media/media-gallery";
import styles from "@/components/media/media.module.css";
import type { MediaCollectionData } from "@/data/media-collections";

type MediaCollectionProps = {
  collection: MediaCollectionData;
  showReport: boolean;
};

export function MediaCollection({ collection, showReport }: MediaCollectionProps) {
  return (
    <section className={styles.collection} id={collection.id} aria-labelledby={`${collection.id}-title`}>
      <header className={styles.collectionHeading}>
        <h2 id={`${collection.id}-title`}>{collection.title}</h2>
        <p>{collection.context}</p>
      </header>
      <MediaGallery collection={collection} />
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
