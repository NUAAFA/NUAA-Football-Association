import Link from "next/link";

import Image from "@/components/ui/site-image";
import { catalogueHref } from "@/lib/catalogue-navigation";
import type { MediaAlbum } from "@/types/media-album";
import styles from "./album.module.css";

export function AlbumCards({ albums, returnQuery = "" }: { albums: readonly MediaAlbum[]; returnQuery?: string }) {
  return <div className={styles.grid}>
    {albums.map((album) => <Link className={styles.card} href={catalogueHref(`/media/albums/${album.id}`, { from: returnQuery })} key={album.id}>
      <div className={styles.cover}>
        <Image src={album.cover.src} alt={album.cover.alt} fill sizes="(max-width: 600px) 90vw, (max-width: 1023px) 44vw, 30vw" />
        <span className={styles.count}>{album.images.length} 张照片</span>
      </div>
      <div className={styles.body}>
        <p className={styles.eyebrow}>{album.kind} · {album.year ?? "年份待补充"}</p>
        <h3>{album.title}</h3>
        <p className={styles.competition}>{album.competitionName}</p>
        <div className={styles.cardFooter}><time dateTime={album.publishedAt ?? undefined}>{album.dateLabel}</time><span>打开相册 <span aria-hidden="true">→</span></span></div>
      </div>
    </Link>)}
  </div>;
}
