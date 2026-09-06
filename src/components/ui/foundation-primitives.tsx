import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type Tone = "primary" | "secondary" | "quiet" | "danger";
type Size = "default" | "small";
type BadgeTone = "info" | "neutral" | "success" | "warning" | "danger";
type NoticeTone = "info" | "success" | "warning" | "danger";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  tone?: Tone;
  size?: Size;
};

export function Button({ className, size = "default", tone = "primary", type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={classNames("ui-button", `ui-button-${tone}`, size === "small" && "ui-button-small", className)}
      type={type}
      {...props}
    />
  );
}

type LinkButtonProps = ComponentPropsWithoutRef<typeof Link> & {
  tone?: Tone;
  size?: Size;
};

export function LinkButton({ className, size = "default", tone = "primary", ...props }: LinkButtonProps) {
  return (
    <Link
      className={classNames("ui-button", `ui-button-${tone}`, size === "small" && "ui-button-small", className)}
      {...props}
    />
  );
}

type PanelProps = ComponentPropsWithoutRef<"div"> & {
  subtle?: boolean;
};

export function Panel({ className, subtle = false, ...props }: PanelProps) {
  return <div className={classNames("ui-panel", subtle && "ui-panel-subtle", className)} {...props} />;
}

type CardProps = ComponentPropsWithoutRef<"article"> & {
  interactive?: boolean;
};

export function Card({ className, interactive = false, ...props }: CardProps) {
  return <article className={classNames("ui-card", interactive && "ui-card-interactive", className)} {...props} />;
}

type BadgeProps = ComponentPropsWithoutRef<"span"> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = "info", ...props }: BadgeProps) {
  return <span className={classNames("ui-badge", `ui-badge-${tone}`, className)} {...props} />;
}

type NoticeProps = ComponentPropsWithoutRef<"aside"> & {
  title?: ReactNode;
  tone?: NoticeTone;
};

export function Notice({ children, className, role = "note", title, tone = "info", ...props }: NoticeProps) {
  return (
    <aside className={classNames("ui-notice", `ui-notice-${tone}`, className)} role={role} {...props}>
      {title ? <strong>{title}</strong> : null}
      {children}
    </aside>
  );
}

type TableContainerProps = ComponentPropsWithoutRef<"div"> & {
  label: string;
  scrollHint?: string;
};

export function TableContainer({
  children,
  className,
  label,
  scrollHint = "可横向滚动查看完整表格",
  tabIndex = 0,
  ...props
}: TableContainerProps) {
  return (
    <div
      aria-label={`${label}。${scrollHint}`}
      className={classNames("ui-table-region", className)}
      role="region"
      tabIndex={tabIndex}
      {...props}
    >
      {children}
    </div>
  );
}
