import NextImage, { type ImageProps } from "next/image";
export type { StaticImageData } from "next/image";

export default function SiteImage(props: ImageProps) {
  const managed = typeof props.src === "string" && props.src.startsWith("/media/");
  return <NextImage {...props} unoptimized={managed || props.unoptimized} />;
}
