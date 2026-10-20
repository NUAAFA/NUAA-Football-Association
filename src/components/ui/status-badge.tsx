type StatusBadgeProps = {
  children: React.ReactNode;
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
};

export function StatusBadge({ children, tone = "info" }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}
