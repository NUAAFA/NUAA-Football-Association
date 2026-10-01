"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function WorkspaceDialog({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); }; }, []);
  return <dialog ref={ref} className="admin-panel ops-workspace-dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}><header className="admin-panel-header"><h2>{title}</h2><button className="admin-button admin-button-secondary" type="button" disabled={busy} onClick={onClose}>关闭</button></header><div className="admin-panel-body">{children}</div></dialog>;
}
