import { LinkButton } from "@/components/ui/foundation-primitives";

type EmptyStateProps = {
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
  compact?: boolean;
};

export function EmptyState({
  title,
  description,
  href,
  actionLabel,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={compact ? "empty-state empty-state-compact" : "empty-state"} role="status">
      <span className="empty-state-mark" aria-hidden="true">—</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {href && actionLabel ? <LinkButton href={href} size="small" tone="secondary">{actionLabel} <span aria-hidden="true">→</span></LinkButton> : null}
    </div>
  );
}
