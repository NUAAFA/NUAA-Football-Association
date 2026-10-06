import Image from "next/image";

import type { ArchiveGalleryImage } from "@/types";

type ArchiveGalleryProps = {
  images: readonly ArchiveGalleryImage[];
  ariaLabel: string;
  className?: string;
  showCaptions?: boolean;
};

export function ArchiveGallery({ images, ariaLabel, className, showCaptions = false }: ArchiveGalleryProps) {
  return (
    <div className={`cup-gallery-balanced${className ? ` ${className}` : ""}`} aria-label={ariaLabel}>
      {images.map((image) => (
        <figure key={image.src}>
          {showCaptions ? <a href={image.src} target="_blank" rel="noopener noreferrer" aria-label={`${image.alt}，查看原图（新标签页）`}>
            <Image src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" sizes="(max-width: 720px) 50vw, (max-width: 1080px) 50vw, 33vw" />
          </a> : <Image
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            loading="lazy"
            sizes="(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 33vw"
          />}
          {showCaptions ? <figcaption>{image.alt}</figcaption> : null}
        </figure>
      ))}
    </div>
  );
}
