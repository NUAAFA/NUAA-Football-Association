"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Nested workspace dialogs share one lock; closing a child must not unlock its parent.
let lockCount = 0;
let restoreScroll: (() => void) | undefined;
function lockPageScroll() {
  if (lockCount++ === 0) {
    const { body, documentElement } = document;
    const x = window.scrollX, y = window.scrollY;
    const properties = ["position", "top", "left", "width", "overflow", "padding-right"];
    const saved = properties.map((name) => [name, body.style.getPropertyValue(name), body.style.getPropertyPriority(name)]);
    const overflow = documentElement.style.overflow;
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    if (scrollbar > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
    documentElement.style.overflow = "hidden";
    Object.assign(body.style, { position: "fixed", top: `-${y}px`, left: `-${x}px`, width: "100%", overflow: "hidden" });
    restoreScroll = () => {
      for (const [name, value, priority] of saved) {
        if (value) body.style.setProperty(name, value, priority);
        else body.style.removeProperty(name);
      }
      documentElement.style.overflow = overflow;
      window.scrollTo({ left: x, top: y, behavior: "instant" });
    };
  }
  return () => {
    if (--lockCount === 0) { restoreScroll?.(); restoreScroll = undefined; }
  };
}

export function WorkspaceDialog({ title, onClose, children, footer, busy = false, className = "" }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; busy?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const unlock = lockPageScroll();
    dialog?.showModal();
    return () => {
      dialog?.close();
      unlock();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className={`ops-workspace-dialog ${className}`} aria-label={title}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <header className="admin-panel-header"><h2>{title}</h2><button className="admin-button admin-button-secondary" type="button" disabled={busy} onClick={onClose}>关闭</button></header>
    <div className="admin-panel-body ops-workspace-dialog-body" tabIndex={0}>{children}</div>
    <footer className="ops-workspace-dialog-footer"><button className="admin-button admin-button-secondary" type="button" disabled={busy} onClick={onClose}>取消</button>{footer}</footer>
  </dialog>;
}
