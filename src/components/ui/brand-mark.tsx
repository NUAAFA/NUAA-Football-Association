import Image from "@/components/ui/site-image";

type BrandMarkProps = {
  compact?: boolean;
};

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <span className={compact ? "brand-mark brand-mark-compact" : "brand-mark"} aria-hidden="true">
      <Image
        src="/brand/nuaa-fa-logo.jpg"
        alt=""
        fill
        sizes={compact ? "42px" : "52px"}
      />
    </span>
  );
}
