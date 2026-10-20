import Image from "next/image";

import styles from "@/components/news/news-listing.module.css";

type NewsImageProps = {
  src: string;
  alt: string;
  variant: "featured" | "list";
  sizes: string;
};

export function NewsImage({ src, alt, variant, sizes }: NewsImageProps) {
  return (
    <div className={variant === "featured" ? styles.featuredImage : styles.rowImage}>
      <Image src={src} alt={alt} fill sizes={sizes} loading={variant === "featured" ? "eager" : "lazy"} />
    </div>
  );
}
